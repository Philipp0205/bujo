import { HttpError } from "../../app-kit/http.ts";
import { inTransaction, type Db } from "../../db.ts";
import type { EntryStore } from "../store.ts";
import type { Entry, NewEntry } from "../types.ts";
import { checkNewEntry } from "../validation.ts";
import type { LogDraft } from "./draft.ts";
import { snapshotOf } from "./fields.ts";
import { toLine, type SentItem, type SentReview } from "./request.ts";
import { resolveLines } from "./resolve.ts";
import type { Resolution } from "./types.ts";

/** What one kept line did to the log: it added an entry or changed one. Lines that change nothing are not listed. */
export type ApplyOutcome = { id: string; outcome: "created" | "updated"; entry: Entry };

/** A sent line with what the matcher decided about it, read against the day as it is now. */
type Planned = { item: SentItem; index: number; resolution: Resolution };

/** The line's fields checked like POST /api/entries, or null when they do not pass. */
function validFields(item: SentItem, date: string): { ok: true; entry: NewEntry } | { ok: false; error: string } {
  const result = checkNewEntry({ date, type: item.type, title: item.title, tags: item.tags, time: item.time });
  return result.ok ? { ok: true, entry: result.value } : { ok: false, error: result.error };
}

/** True for a kept line that would add or change an entry. */
function isWrite({ item, resolution }: Planned): boolean {
  return item.include && (resolution.status === "new" || resolution.status === "edited");
}

/** Reads the day again and decides every sent line, skipped ones too, so a skipped line still holds its entry as in the check. */
function planReview(store: EntryStore, userId: string, review: SentReview): Planned[] {
  const existing = store.listScan(userId, { from: review.date, to: review.date });
  const resolved = resolveLines(review.items.map(toLine), existing);
  return review.items.map((item, index) => ({ item, index, resolution: resolved.get(item.id)! }));
}

/** A bad title, tags or time on a kept line is a 400 that names the line. Throws before anything is written. */
function checkKept(plan: readonly Planned[], date: string): void {
  for (const { item, index } of plan) {
    const result = item.include ? validFields(item, date) : null;
    if (result && !result.ok) throw new HttpError(400, `items[${index}]: ${result.error}`);
  }
}

/** Adds a new entry at the end of the day, or changes the four scanned fields of the matched one. Never touches date, indent, position or body. */
function writeOne(store: EntryStore, userId: string, date: string, now: number, { item, resolution }: Planned): ApplyOutcome {
  const paper = validFields(item, date);
  if (!paper.ok) throw new HttpError(400, paper.error);
  if (resolution.status === "edited" && resolution.target && resolution.after) {
    const { type, title, tags, time } = resolution.after;
    const updated = store.update(userId, resolution.target.id, { type, title, tags, time }, now)!;
    store.setScanProvenance(userId, updated.id, snapshotOf(paper.entry, now));
    return { id: item.id, outcome: "updated", entry: updated };
  }
  const created = store.create(userId, paper.entry, now);
  store.setScanProvenance(userId, created.id, snapshotOf(paper.entry, now));
  return { id: item.id, outcome: "created", entry: created };
}

/**
 * Records the paper line on a matched entry that did not change, so the next scan knows its key. It writes no content and
 * leaves updated_at and sync alone. An entry the person changed in the app is not stamped: a stamp would hide that edit.
 */
function stampUnchanged(store: EntryStore, userId: string, date: string, now: number, { item, resolution }: Planned): void {
  if (resolution.status !== "unchanged" || !resolution.target || resolution.protectedEdit) return;
  const paper = validFields(item, date);
  if (paper.ok) store.setScanProvenance(userId, resolution.target.id, snapshotOf(paper.entry, now));
}

/**
 * Writes what the person kept from a draft into the log, sync state local (the route then queues the push). Kept new lines add
 * entries, kept edited lines change their entry's type, title, tags or time, and nothing is ever deleted. Unchanged lines are
 * recorded (key only) and change no content, even when ticked. The whole request is checked first, the day is read again here
 * (the client's status is not trusted), and the writes share one transaction: all or nothing. A draft can be applied once.
 * Throws 409 when it was applied, 400 for a bad request or when no kept line would add or change anything.
 */
export function applyLogDraft(
  db: Db,
  store: EntryStore,
  userId: string,
  draft: LogDraft,
  review: SentReview,
  now: number,
): ApplyOutcome[] {
  if (draft.applied) throw new HttpError(409, "This scan was already applied.");
  const plan = planReview(store, userId, review);
  checkKept(plan, review.date);
  if (!plan.some(isWrite)) throw new HttpError(400, "nothing to apply: keep at least one new or changed line");
  const outcomes = inTransaction(db, () => {
    plan.forEach((planned) => stampUnchanged(store, userId, review.date, now, planned));
    return plan.filter(isWrite).map((planned) => writeOne(store, userId, review.date, now, planned));
  });
  draft.applied = true;
  return outcomes;
}
