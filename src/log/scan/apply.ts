import { HttpError } from "../../app-kit/http.ts";
import { inTransaction, type Db } from "../../db.ts";
import type { EntryStore } from "../store.ts";
import type { Entry, NewEntry } from "../types.ts";
import { checkNewEntry } from "../validation.ts";
import type { LogDraft } from "./draft.ts";
import type { SentItem, SentReview } from "./request.ts";
import { resolveLines, type Resolution } from "./resolve.ts";

/** What one kept line did to the log. */
export type ApplyOutcome = { id: string; outcome: "created" | "completed"; entry: Entry };

/** An included line that has passed the same checks as POST /api/entries, with its entry fields ready to write. */
type Checked = { item: SentItem; entry: NewEntry };

/** Checks one kept line like a new entry. A bad title or tag is a 400 that names the line. */
function checkItem(item: SentItem, date: string, index: number): Checked {
  const result = checkNewEntry({ date, type: item.type, title: item.title, tag: item.tag });
  if (!result.ok) throw new HttpError(400, `items[${index}]: ${result.error}`);
  return { item, entry: result.value };
}

/** The kept lines of a request, all checked. Throws before anything is written. */
function checkKept(review: SentReview): Checked[] {
  const kept = review.items.map((item, index) => ({ item, index })).filter(({ item }) => item.include);
  if (kept.length === 0) throw new HttpError(400, "nothing to apply: keep at least one line");
  return kept.map(({ item, index }) => checkItem(item, review.date, index));
}

/** Writes one kept line: marks its task done, or adds an entry at the end of the day. */
function writeOne(store: EntryStore, userId: string, now: number, checked: Checked, resolution: Resolution): ApplyOutcome {
  const { item, entry } = checked;
  if (resolution.status === "completes" && resolution.target) {
    const updated = store.update(userId, resolution.target.id, { type: "done" }, now)!;
    return { id: item.id, outcome: "completed", entry: updated };
  }
  return { id: item.id, outcome: "created", entry: store.create(userId, entry, now) };
}

/**
 * Writes the kept lines of a draft into the log, sync state local. The whole request is checked first, the day is
 * read again here (the client's idea of a duplicate is not trusted), and the writes share one transaction: all or
 * nothing. A draft can be applied once. Throws 409 when it was applied, 400 for a bad request.
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
  const kept = checkKept(review);
  const existing = store.list(userId, { from: review.date, to: review.date });
  const resolved = resolveLines(kept.map(({ item }) => ({ id: item.id, type: item.type, title: item.title })), existing);
  const outcomes = inTransaction(db, () => kept.map((checked) => writeOne(store, userId, now, checked, resolved.get(checked.item.id)!)));
  draft.applied = true;
  return outcomes;
}
