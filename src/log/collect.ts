import { inTransaction, type Db } from "../db.ts";
import { createEntryStore } from "./store.ts";
import { createTraceStore } from "./trace.ts";
import { BODY_MAX, checkNewEntry } from "./validation.ts";
import type { Checked, Entry, NewEntry } from "./types.ts";

/** Where a moved entry goes: a collection that exists, or a new one with this title and day. */
export type CollectTarget = { collectionId: string } | { title: string; date: string };

/** A refusal with the HTTP status the route answers. The message is safe to show. */
export type CollectRefusal = { status: 400 | 404; error: string };

/** What a move into a collection is going to do, checked and ready to apply. */
export type CollectPlan = { entry: Entry; collection: Entry | null; created: NewEntry | null; body: string };

export const COLLECT_MESSAGES = {
  notAnEntry: "a collection cannot be moved into a collection",
  unknownCollection: "unknown collection",
  sameEntry: "an entry cannot be moved into itself",
  tooLong: `the collection is full: adding this line would pass ${BODY_MAX} characters`,
} as const;

/** True for the target of a new collection (a title and a day), false for an existing one (its id). */
function isNew(target: CollectTarget): target is { title: string; date: string } {
  return "title" in target;
}

/** Checks a request body: { collectionId } for an existing collection, or { title, date } for a new one. The title and day are checked with the plan. */
export function checkCollectTarget(body: Record<string, unknown>): Checked<CollectTarget> {
  const keys = Object.keys(body);
  if (typeof body.collectionId === "string" && keys.length === 1) return { ok: true, value: { collectionId: body.collectionId } };
  if (typeof body.title === "string" && typeof body.date === "string" && keys.length === 2) return { ok: true, value: { title: body.title, date: body.date } };
  return { ok: false, error: "send collectionId, or title and date for a new collection" };
}

/** The markdown line an entry becomes in a collection. */
export function collectionLine(entry: Pick<Entry, "title">): string {
  return `- ${entry.title}`;
}

/** The body with one more line at its end, after the text that is already there. */
function appended(body: string | null, line: string): string {
  const head = (body ?? "").replace(/\s+$/, "");
  return head === "" ? line : `${head}\n${line}`;
}

/** Checks a move into a collection against the entry and the collection as they are now, and works out the new body. Writes nothing. */
export function planCollect(db: Db, userId: string, entryId: string, target: CollectTarget): CollectPlan | CollectRefusal {
  const store = createEntryStore(db);
  const entry = store.get(userId, entryId);
  if (!entry) return { status: 404, error: "unknown entry" };
  if (entry.body !== null && entry.body !== "") return { status: 400, error: COLLECT_MESSAGES.notAnEntry };
  const line = collectionLine(entry);
  if (isNew(target)) {
    const checked = checkNewEntry({ type: "note", title: target.title, date: target.date, body: line });
    if (!checked.ok) return { status: 400, error: checked.error };
    return { entry, collection: null, created: checked.value, body: line };
  }
  if (target.collectionId === entryId) return { status: 400, error: COLLECT_MESSAGES.sameEntry };
  const collection = store.get(userId, target.collectionId);
  if (!collection || collection.body === null || collection.body === "") return { status: 404, error: COLLECT_MESSAGES.unknownCollection };
  const body = appended(collection.body, line);
  if (body.length > BODY_MAX) return { status: 400, error: COLLECT_MESSAGES.tooLong };
  return { entry, collection, created: null, body };
}

/**
 * Files the entry in the collection in one transaction: the line goes to the end of the collection's body (a new collection is made when
 * the plan has none), the old page keeps a "collected" trace (its entry id is the collection's, so it outlives the entry, and its title is the
 * collection's), and the entry leaves the log. Nothing on the sync target is touched here. Returns the collection as it is now.
 */
export function applyCollect(db: Db, userId: string, plan: CollectPlan, now: number): Entry {
  const store = createEntryStore(db);
  const traces = createTraceStore(db);
  return inTransaction(db, () => {
    const collection = plan.created ? store.create(userId, plan.created, now) : store.update(userId, plan.collection!.id, { body: plan.body }, now)!;
    traces.record(userId, { ...plan.entry, id: collection.id, title: collection.title }, "collected", now);
    store.remove(userId, plan.entry.id);
    return collection;
  });
}
