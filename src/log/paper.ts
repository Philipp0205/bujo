import type { EntryStore } from "./store.ts";
import type { Entry, ScanSnapshot } from "./types.ts";
import { editedInApp, snapshotOf } from "./scan/fields.ts";

/**
 * True when the entry is on the paper page: a scan (or a manual mark) has been applied to it and the person has not
 * changed type, title, tags or time in the app since. The same rule the scan matcher uses to protect an app edit.
 * No snapshot means not on paper, whatever the age of the row.
 */
export function onPaper(entry: Pick<Entry, "type" | "title" | "tags" | "time" | "updatedAt">, snapshot: ScanSnapshot | null): boolean {
  return snapshot !== null && !editedInApp(entry, snapshot);
}

/**
 * Stamps the entry's current four fields as the paper state ("I wrote this down"). Not an edit: updated_at and sync stay.
 * Returns the entry as it is now, or undefined for an unknown entry.
 */
export function markWritten(store: EntryStore, userId: string, id: string, now: number): Entry | undefined {
  const entry = store.get(userId, id);
  if (!entry) return undefined;
  store.setScanProvenance(userId, id, snapshotOf(entry, now));
  return store.get(userId, id);
}
