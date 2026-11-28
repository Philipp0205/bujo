import { matchKey } from "../scan/match.ts";
import type { EntryOrigin, ScanSnapshot } from "./types.ts";

/**
 * Where an entry's text came from, for the handwriting font in the app. A scan import stores "scan" on the row.
 * Rule: it stays "scan" only while the title is as the scan left it. If the person changes the title in the app after the
 * scan (a later update, and a title key that differs from the snapshot's), the entry reads "app" from then on. Other fields
 * (type, tags, time, done) do not change the origin. Rows with nothing stored, and old rows, are "app".
 */
export function originOf(stored: string | null, entry: { title: string; updatedAt: number }, snapshot: ScanSnapshot | null): EntryOrigin {
  if (stored !== "scan" || snapshot === null) return "app";
  const retitled = entry.updatedAt > snapshot.at && matchKey(entry.title) !== snapshot.key;
  return retitled ? "app" : "scan";
}
