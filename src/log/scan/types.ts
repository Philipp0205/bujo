import type { EntryHorizon, EntryType, ScanEntry } from "../types.ts";

/** What a photographed log page is: a day, the future log, a month's calendar page or a month's task page. */
export const PAGE_KINDS = ["daily", "future", "calendar", "month-task"] as const;
export type PageKind = (typeof PAGE_KINDS)[number];

/** True for a page kind name the API knows. */
export function isPageKind(value: unknown): value is PageKind {
  return typeof value === "string" && (PAGE_KINDS as readonly string[]).includes(value);
}

/** The log view the person had open when scanning: a weak hint for the page kind. */
export const VIEW_HINTS = ["daily", "future", "month"] as const;
export type ViewHint = (typeof VIEW_HINTS)[number];

/** Where a line files: one day, or one month's lane (date is then the last day of that month). Matching is per slot. */
export type Slot = { horizon: EntryHorizon; date: string };

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

/**
 * One paper line as the matcher reads it. Tags or a time left out or empty mean the paper does not say them.
 * `unmatched` is the person saying "not the same item": the line matches no entry and no trace, so it is new.
 */
export type Line = { id: string; type: EntryType; title: string; tags?: string[]; time?: string | null; unmatched?: boolean };

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
