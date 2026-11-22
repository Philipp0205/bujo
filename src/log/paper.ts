import { addDays } from "./date-token.ts";
import type { EntryStore } from "./store.ts";
import type { Entry, ScanSnapshot } from "./types.ts";
import { editedInApp, snapshotOf } from "./scan/fields.ts";

/**
 * How many days back an entry still counts as a "not on paper" candidate. Older app entries predate scan provenance and
 * would all look unwritten. The browser keeps a twin, PAPER_WINDOW_DAYS in public/js/log/paper/recent.js: keep them equal.
 */
export const PAPER_WINDOW_DAYS = 14;

/**
 * True when an entry dated `date` is a not-on-paper candidate: today or up to PAPER_WINDOW_DAYS back (boundary included).
 * A future day is always in, since it is upcoming and not an old leftover. Both arguments are YYYY-MM-DD.
 */
export function inPaperWindow(date: string, today: string): boolean {
  return date >= addDays(today, -PAPER_WINDOW_DAYS);
}

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
