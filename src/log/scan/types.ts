import type { EntryType, ScanEntry } from "../types.ts";

/**
 * What a scanned line means for the log of its day:
 *   new        no 1:1 match among the day's entries: a fresh entry
 *   edited     matched, and the paper differs from the entry in type, title, tags or time (tags compare as a set)
 *   unchanged  matched, and the paper says what the entry says (or the person changed the entry in the app since the last scan)
 * A day entry that no line matches is not a status: it is left alone and never deleted.
 */
export type ScanStatus = "new" | "edited" | "unchanged";

/** The four fields a scan can set on an entry. */
export type Fields = { type: EntryType; title: string; tags: string[]; time: string | null };

/** One paper line as the matcher reads it. Tags or a time left out or empty mean the paper does not say them. */
export type Line = { id: string; type: EntryType; title: string; tags?: string[]; time?: string | null };

/** What the matcher decided for one line. */
export type Resolution = {
  status: ScanStatus;
  /** The entry the line is bound to, or null for a new line. */
  target: ScanEntry | null;
  /** The entry as it is now and the paper proposal. Both set for "edited", null otherwise. */
  before: Fields | null;
  after: Fields | null;
  /** True when the paper and the app both changed the entry since the last scan: the line starts unticked. */
  contested: boolean;
  /** True for an unchanged line that only looks unchanged because the entry was edited in the app. It is never restamped. */
  protectedEdit: boolean;
};
