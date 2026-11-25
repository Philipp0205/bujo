import { HttpError } from "../../app-kit/http.ts";
import { inTransaction, type Db } from "../../db.ts";
import { settleHorizon } from "../horizon.ts";
import { createPaperPageStore, type PaperKind } from "../paper-pages.ts";
import type { EntryStore } from "../store.ts";
import type { Entry, NewEntry } from "../types.ts";
import { checkNewEntry } from "../validation.ts";
import type { LogDraft } from "./draft.ts";
import { snapshotOf } from "./fields.ts";
import { pageReader, resolveSlots, type Planned as Resolved, type SlotReader } from "./plan.ts";
import { placeReview, type SentItem, type SentReview } from "./request.ts";
import type { Slot } from "./types.ts";

/** What one kept line did to the log: it added an entry or changed one. Lines that change nothing are not listed. `unflag` is set when the review explicitly turned important off. */
export type ApplyOutcome = { id: string; outcome: "created" | "updated"; entry: Entry; unflag?: boolean };

/** A sent line with its slot and what the matcher decided about it, read against that slot as it is now. */
type Planned = { item: SentItem; index: number; slot: Slot | null; resolution: Resolved };

/** The line's fields checked like POST /api/entries, as the slot stores them (a month entry has no event type), or the error. */
function validFields(item: SentItem, slot: Slot): { ok: true; entry: NewEntry } | { ok: false; error: string } {
  const result = checkNewEntry({ date: slot.date, horizon: slot.horizon, type: item.type, title: item.title, tags: item.tags, time: item.time, important: item.important });
  return result.ok ? { ok: true, entry: settleHorizon(result.value, slot.horizon) } : { ok: false, error: result.error };
}

/** True for a kept line that would add or change an entry. */
function isWrite({ item, resolution }: Planned): boolean {
  return item.include && (resolution.status === "new" || resolution.status === "edited");
}

/** Reads every slot again and decides every sent line, skipped ones too, so a skipped line still holds its entry as in the check. */
function planReview(reader: SlotReader, review: SentReview, fallbackDate: string): Planned[] {
  const placed = placeReview(review, fallbackDate);
  const resolved = resolveSlots(placed, reader);
  return review.items.map((item, index) => ({ item, index, slot: placed[index].slot, resolution: resolved.get(item.id)! }));
}

/** A bad title, tags or time on a kept line is a 400 that names the line, and so is a kept line with no real day or month. Throws before anything is written. */
function checkKept(plan: readonly Planned[]): void {
  for (const { item, index, slot } of plan) {
    if (!item.include) continue;
    if (!slot) throw new HttpError(400, `items[${index}]: needs a real day or month`);
    const result = validFields(item, slot);
    if (!result.ok) throw new HttpError(400, `items[${index}]: ${result.error}`);
  }
}

/** Adds a new entry at the end of its slot, or changes the four scanned fields of the matched one. Never touches date, indent or body (the page filing sets the position, then applyIndents the indent). */
function writeOne(store: EntryStore, userId: string, now: number, { item, slot, resolution }: Planned): ApplyOutcome {
  const paper = validFields(item, slot!);
  if (!paper.ok) throw new HttpError(400, paper.error);
  if (resolution.status === "edited" && resolution.target && resolution.after) {
    const { type, title, tags, time } = resolution.after;
    // A * on the paper (or turned on in the review) sets important. A line without one never clears it, unless the review turned it off.
    const mark = item.important ? { important: true } : item.unflag ? { important: false } : {};
    const updated = store.update(userId, resolution.target.id, { type, title, tags, time, ...mark }, now)!;
    // The paper state is what the entry now says: a title the paper only misspelled stays as the entry has it.
    store.setScanProvenance(userId, updated.id, snapshotOf(updated, now));
    return { id: item.id, outcome: "updated", entry: updated, unflag: item.unflag && !item.important };
  }
  const created = store.create(userId, paper.entry, now);
  store.setScanProvenance(userId, created.id, snapshotOf(paper.entry, now));
  return { id: item.id, outcome: "created", entry: created };
}

/**
 * Records the paper line on a matched entry that did not change, so the next scan knows its key. It writes no content and
 * leaves updated_at and sync alone. The entry's own fields are stamped, so a line with OCR noise never puts the noise on the entry.
 * An entry the person changed in the app is not stamped: a stamp would hide that edit.
 * A line that matched a trace has no entry and is not stamped.
 */
function stampUnchanged(store: EntryStore, userId: string, now: number, { item, slot, resolution }: Planned): void {
  if (resolution.status !== "unchanged" || !resolution.target || resolution.protectedEdit || !slot) return;
  const paper = validFields(item, slot);
  if (paper.ok) store.setScanProvenance(userId, resolution.target.id, snapshotOf(resolution.target, now));
}

/**
 * Files the entries of the page in the order of the paper lines: a line's entry is the one it created or changed, or the one it
 * matched unchanged (even when skipped, it is still on the paper). Per slot, in page order. Lines with no entry are left out.
 */
function placeOnPaper(store: EntryStore, userId: string, page: number, plan: readonly Planned[], outcomes: readonly ApplyOutcome[]): void {
  const written = new Map(outcomes.map((outcome) => [outcome.id, outcome.entry.id]));
  const bySlot = new Map<string, { slot: Slot; ids: string[] }>();
  for (const { item, slot, resolution } of plan) {
    const id = written.get(item.id) ?? resolution.target?.id;
    if (!slot || !id) continue;
    const group = bySlot.get(`${slot.horizon}|${slot.date}`) ?? { slot, ids: [] };
    if (!group.ids.includes(id)) group.ids.push(id);
    bySlot.set(`${slot.horizon}|${slot.date}`, group);
  }
  for (const { slot, ids } of bySlot.values()) store.placeOnPaper(userId, slot, page, ids);
}

/**
 * Sets the indent the paper shows on each kept line's entry (new or matched), after the filing set the order, through the store so a 1 with
 * no entry above stays 0. Only a daily page nests. A line the person left out, or an unchanged entry they edited in the app, is not touched.
 * Indent is not a compared field: it never makes a line "edited" and never counts as a write.
 */
function applyIndents(store: EntryStore, userId: string, review: SentReview, plan: readonly Planned[], outcomes: readonly ApplyOutcome[]): void {
  if (review.kind !== "daily") return;
  const written = new Map(outcomes.map((outcome) => [outcome.id, outcome.entry.id]));
  for (const { item, resolution } of plan) {
    const id = written.get(item.id) ?? (resolution.protectedEdit ? undefined : resolution.target?.id);
    if (item.include && id) store.setIndent(userId, id, item.indent);
  }
}

/** Where the notebook page number of this review is kept: a day's physical page, a month log, or a future log (its earliest month). Null when no place can be told. */
function paperPlace(review: SentReview, plan: readonly Planned[], fallbackDate: string): { kind: PaperKind; ref: string; page: number } | null {
  if (review.kind === "daily") return { kind: "day", ref: review.date ?? fallbackDate, page: review.page };
  if (review.kind !== "future") return review.month ? { kind: "month", ref: review.month, page: 1 } : null;
  const months = plan.flatMap(({ slot }) => (slot ? [slot.date.slice(0, 7)] : [])).sort();
  return months.length > 0 ? { kind: "future", ref: months[0], page: 1 } : null;
}

/**
 * Keeps the notebook page number the review sent (none sent: nothing changes, a stored number is never cleared). A failure to
 * store is logged and swallowed: in SQLite a failed statement leaves the transaction alive, so the entries already written stay.
 */
function storePaperNumber(db: Db, userId: string, review: SentReview, plan: readonly Planned[], fallbackDate: string): void {
  const place = review.paperNumber === null ? null : paperPlace(review, plan, fallbackDate);
  if (!place || review.paperNumber === null) return;
  try {
    createPaperPageStore(db).save(userId, place.kind, place.ref, place.page, review.paperNumber);
  } catch (error) {
    console.error("paper page number not saved:", error instanceof Error ? error.name : "error");
  }
}

/**
 * Writes what the person kept from a draft into the log, sync state local (the route then queues the push). Kept new lines add
 * entries, kept edited lines change their entry's type, title, tags or time, and nothing is ever deleted. Unchanged lines are
 * recorded (key only) and change no content, even when ticked. Each line files in its own slot (a day, or a month's lane) and
 * matches only the entries of that slot and of the scanned physical page (or not on paper). Entries of a page are then filed in
 * the paper's line order after earlier pages, so a rescan of page 1 keeps page 2 and a first scan of page 2 appends to the day.
 * The whole request is checked first, the slots are read again here (the client's status
 * is not trusted), and the writes share one transaction: all or nothing, the notebook page number included (see storePaperNumber). A draft can be applied once.
 * Throws 409 when it was applied, 400 for a bad request or when no kept line would add or change anything.
 */
export function applyLogDraft(
  db: Db,
  store: EntryStore,
  reader: SlotReader,
  userId: string,
  draft: LogDraft,
  review: SentReview,
  now: number,
): ApplyOutcome[] {
  if (draft.applied) throw new HttpError(409, "This scan was already applied.");
  const plan = planReview(pageReader(reader, review.page), review, draft.fallbackDate);
  checkKept(plan);
  if (!plan.some(isWrite)) throw new HttpError(400, "nothing to apply: keep at least one new or changed line");
  const outcomes = inTransaction(db, () => {
    plan.forEach((planned) => stampUnchanged(store, userId, now, planned));
    const done = plan.filter(isWrite).map((planned) => writeOne(store, userId, now, planned));
    placeOnPaper(store, userId, review.page, plan, done);
    applyIndents(store, userId, review, plan, done);
    storePaperNumber(db, userId, review, plan, draft.fallbackDate);
    return done;
  });
  draft.applied = true;
  return outcomes;
}
