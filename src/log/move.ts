import { inTransaction, type Db } from "../db.ts";
import { createEntryStore } from "./store.ts";
import { createTraceStore } from "./trace.ts";
import type { Entry, EntryChange } from "./types.ts";

/**
 * Applies an edit and, when it moves the entry to another page (day, or month lane), keeps the trail in step, all in one transaction:
 * the entry keeps its id (so its UID and sync link too) and takes its new date and horizon from the store; a requested trace is
 * left on the old page; a trace of this entry on the page it arrives at goes (it is home again); and the scan provenance is cleared,
 * because the line on paper sits on the old page, so the entry is not on paper where it is now.
 * An edit that stays on the same page changes the fields only. Undefined for an unknown entry.
 */
export function updateEntry(db: Db, userId: string, id: string, change: EntryChange, now: number): Entry | undefined {
  const store = createEntryStore(db);
  const traces = createTraceStore(db);
  const { trace, ...patch } = change;
  return inTransaction(db, () => {
    const before = store.get(userId, id);
    if (!before) return undefined;
    const after = store.update(userId, id, patch, now);
    // Filing an entry on a collection (or back on the log) changes its page: the paper line it had no longer matches where it sits.
    if (after && before.collectionId !== after.collectionId) store.clearScanProvenance(userId, id);
    if (!after || (before.date === after.date && before.horizon === after.horizon)) return store.get(userId, id);
    traces.clearAt(userId, id, after.date, after.horizon);
    if (!trace) return after;
    traces.record(userId, before, trace, now);
    store.clearScanProvenance(userId, id);
    return store.get(userId, id);
  });
}
