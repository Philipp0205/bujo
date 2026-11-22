import { matchKey } from "../../scan/match.ts";
import type { Entry, NewEntry, ScanSnapshot } from "../types.ts";
import type { Fields } from "./types.ts";

/** Trimmed lowercase text, for comparing tags ignoring case and edge spaces. */
export const norm = (text: string | null | undefined): string => (text ?? "").trim().toLowerCase();

/** The tags as a sorted list of lowercase keys, so two lists compare as sets (order and case do not matter). */
export const tagKeys = (tags: readonly string[]): string => [...new Set(tags.map(norm))].sort().join("\n");

/** The fields of an entry as the scan compares them. */
export function fieldsOf(entry: Pick<Entry, "type" | "title" | "tags" | "time">): Fields {
  return { type: entry.type, title: entry.title, tags: entry.tags, time: entry.time };
}

/** True when every field is the same (a title up to case, spacing, punctuation and umlaut spelling; tags as a set; time exact). */
export function sameFields(a: Fields, b: Fields): boolean {
  return a.type === b.type && matchKey(a.title) === matchKey(b.title) && tagKeys(a.tags) === tagKeys(b.tags) && a.time === b.time;
}

/** The compared fields of a stored snapshot. */
export const snapshotFields = (snap: ScanSnapshot): Fields => ({ type: snap.type, title: snap.title, tags: snap.tags, time: snap.time });

/** The snapshot a paper line (or a manual "written" mark) leaves on an entry: the four fields, their title key, and when. */
export function snapshotOf(entry: Pick<NewEntry, "type" | "title" | "tags" | "time">, now: number): ScanSnapshot {
  return { key: matchKey(entry.title), type: entry.type, title: entry.title, tags: entry.tags, time: entry.time, at: now };
}

/** True when the person changed the entry in the app after the last scan wrote it. */
export function editedInApp(entry: Pick<Entry, "type" | "title" | "tags" | "time" | "updatedAt">, snap: ScanSnapshot | null | undefined): snap is ScanSnapshot {
  return !!snap && entry.updatedAt > snap.at && !sameFields(fieldsOf(entry), snapshotFields(snap));
}
