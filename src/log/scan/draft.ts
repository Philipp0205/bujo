import { randomBytes } from "node:crypto";
import type { OcrResult } from "../../scan/ocr-client.ts";
import type { ScanEntry } from "../types.ts";
import { parsePage, type ParsedLine } from "./parse.ts";
import { resolveLines } from "./resolve.ts";
import type { Fields, Line, ScanStatus } from "./types.ts";

/**
 * A rapid-log scan draft: the parsed lines of one photo, held in memory (the store in src/scan/store.ts) and
 * never holding the photo. Nothing in it is written to the log until the apply step.
 * Whether a line is new, edited or unchanged depends on its day and its edited text, so that is
 * worked out per request (checkLines) and is not part of the draft.
 */
export type LogDraft = {
  id: string;
  created: number;
  expires: number;
  /** YYYY-MM-DD from the page header, or null when none was read. */
  pageDate: string | null;
  /** The day to use when the page names none: the day picked in the log, else today. */
  fallbackDate: string;
  image: { width: number; height: number };
  lines: ParsedLine[];
  applied: boolean;
};

/** What the review is told about one line for one day. */
export type LineCheck = {
  id: string;
  status: ScanStatus;
  /** The entry of the day the line is matched to (for "edited" and "unchanged"), else null. */
  target: { id: string; title: string } | null;
  /** For an "edited" line: the entry as it is now and what the paper proposes. Null otherwise. */
  before: Fields | null;
  after: Fields | null;
  /** True when the paper and the app both changed the entry since the last scan. Such a line starts unticked. */
  contested: boolean;
};

/** A line as the review starts: the parsed line, its check and whether it starts ticked. */
export type ReviewItem = ParsedLine & LineCheck & { include: boolean };

export type Review = {
  id: string;
  expires: number;
  /** The day the entries land on to start with: the page date, else the fallback. */
  date: string;
  /** The date the page header named, or null. The review words its date row from these two. */
  pageDate: string | null;
  fallbackDate: string;
  items: ReviewItem[];
};

export type DraftInput = {
  ocr: OcrResult;
  fallbackDate: string;
  now: number;
  ttlMs: number;
  id?: string;
};

/** Builds a draft from one OCR answer. */
export function buildLogDraft(input: DraftInput): LogDraft {
  const page = parsePage(input.ocr.lines, input.fallbackDate);
  return {
    id: input.id ?? randomBytes(16).toString("base64url"),
    created: input.now,
    expires: input.now + input.ttlMs,
    pageDate: page.pageDate,
    fallbackDate: input.fallbackDate,
    image: { width: input.ocr.width, height: input.ocr.height },
    lines: page.lines,
    applied: false,
  };
}

/** The day the review starts on: the page header, else the fallback. */
export function defaultDate(draft: LogDraft): string {
  return draft.pageDate ?? draft.fallbackDate;
}

/**
 * Checks lines (as the review holds them, edits included) against the entries of one day.
 * Pure: `existing` is that day's entries, and nothing is written.
 */
export function checkLines(lines: readonly Line[], existing: readonly ScanEntry[]): LineCheck[] {
  const resolved = resolveLines(lines, existing);
  return lines.map((line) => {
    const { status, target, before, after, contested } = resolved.get(line.id)!;
    return { id: line.id, status, target: target ? { id: target.id, title: target.title } : null, before, after, contested };
  });
}

/**
 * A line starts ticked when it would write something and can be trusted: a new line with a bullet and text, or an edit with a
 * bullet that the app did not also change. An unchanged line, and a line with no bullet (maybe a stray mark), start off.
 */
function startsIncluded(line: ParsedLine, check: LineCheck): boolean {
  if (line.noBullet) return false;
  if (check.status === "new") return line.title !== "";
  return check.status === "edited" && !check.contested;
}

/** The review a fresh draft starts with, for its default day. `existing` is that day's entries with their scan provenance. */
export function startReview(draft: LogDraft, existing: readonly ScanEntry[]): Review {
  const date = defaultDate(draft);
  const checks = checkLines(draft.lines, existing);
  return {
    id: draft.id,
    expires: draft.expires,
    date,
    pageDate: draft.pageDate,
    fallbackDate: draft.fallbackDate,
    items: draft.lines.map((line, index) => ({ ...line, ...checks[index], include: startsIncluded(line, checks[index]) })),
  };
}
