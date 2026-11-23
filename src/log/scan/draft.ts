import { randomBytes } from "node:crypto";
import type { OcrResult } from "../../scan/ocr-client.ts";
import type { ScanEntry } from "../types.ts";
import { detectKind, type Detected } from "./kind.ts";
import { parsePage, type PageLine, type ParsedLine } from "./parse.ts";
import { pageReader, resolveSlots, slotOf, type Placed, type SlotReader, type Where } from "./plan.ts";
import { MAX_PAPER_PAGE } from "./request.ts";
import { resolveLines } from "./resolve.ts";
import type { Fields, Line, PageKind, Resolution, ScanStatus, ViewHint } from "./types.ts";

/**
 * A log-page scan draft: the OCR lines of one photo (text and bullet, never the box or the photo), held in memory (the store in
 * src/scan/store.ts). Nothing in it is written to the log until the apply step. The page is parsed for a kind on demand, so
 * the person can switch the kind and the lines are read again. Whether a line is new, edited or unchanged depends on its slot
 * and its edited text, so that is worked out per request (checkLines, resolveSlots) and is not part of the draft.
 */
export type LogDraft = {
  id: string;
  created: number;
  expires: number;
  /** The day to use when the page names none: the day picked in the log, else today. */
  fallbackDate: string;
  image: { width: number; height: number };
  /** The OCR lines in page order. Line ids are l1, l2, ... by position here, whatever the kind. */
  page: PageLine[];
  /** What the OCR service said about the page (the LLM engine), or nulls. Only a hint. */
  llm: { kind: string | null; period: string | null };
  /** The kind found when the photo came in, and what it was found from. */
  detected: Detected;
  applied: boolean;
};

/** What the review is told about one line for one slot. `traced` is only present (true) when a trace on the old page matched it. */
export type LineCheck = {
  id: string;
  status: ScanStatus;
  /** The entry of the slot the line is matched to (for "edited" and "unchanged"), else null. */
  target: { id: string; title: string } | null;
  /** For an "edited" line: the entry as it is now and what the paper proposes. Null otherwise. */
  before: Fields | null;
  after: Fields | null;
  /** True when the paper and the app both changed the entry since the last scan. Such a line starts unticked. */
  contested: boolean;
  traced?: true;
};

/** A line as the review starts: the parsed line, its check and whether it starts ticked. */
export type ReviewItem = ParsedLine & LineCheck & { include: boolean };

export type Review = {
  id: string;
  expires: number;
  /** The kind the lines are read for now (the detected one, or the one the person picked). */
  kind: PageKind;
  /** The kind found on the photo and where that came from: the LLM, the page, the open view, or nothing. */
  detected: Detected;
  /** The day a daily page files on to start with: the page date, else the fallback. Also what a switch to daily starts on. */
  date: string;
  /** The date the page header named, or null. The review words its date row from these two. */
  pageDate: string | null;
  fallbackDate: string;
  /** The month (YYYY-MM) of a calendar or month-task page, else null. */
  month: string | null;
  /** The physical page of the day this scan is taken for: a rescan of the page its lines match, else the next new page. Only a daily page has a choice. */
  page: number;
  /** The pages the day already has paper for, ascending, so the review can offer them as rescans. Empty for any kind but daily. */
  pages: number[];
  items: ReviewItem[];
};

export type DraftInput = {
  ocr: OcrResult;
  fallbackDate: string;
  now: number;
  ttlMs: number;
  /** The log view open when scanning. Left out means none. */
  hint?: ViewHint | null;
  id?: string;
};

/** Builds a draft from one OCR answer: keeps the lines (without their boxes) and the kind they read as. */
export function buildLogDraft(input: DraftInput): LogDraft {
  const page = input.ocr.lines.map(({ symbol, text, confidence }) => ({ symbol, text, confidence }));
  return {
    id: input.id ?? randomBytes(16).toString("base64url"),
    created: input.now,
    expires: input.now + input.ttlMs,
    fallbackDate: input.fallbackDate,
    image: { width: input.ocr.width, height: input.ocr.height },
    page,
    llm: { kind: input.ocr.kind ?? null, period: input.ocr.period ?? null },
    detected: detectKind(page, input.hint ?? null, input.fallbackDate, input.ocr.kind),
    applied: false,
  };
}

/** The check of one resolved line, in the shape the API answers. */
function toCheck(id: string, resolved: Resolution & { traced?: boolean }): LineCheck {
  const { status, target, before, after, contested, traced } = resolved;
  const check: LineCheck = { id, status, target: target ? { id: target.id, title: target.title } : null, before, after, contested };
  return traced ? { ...check, traced: true } : check;
}

/**
 * Checks daily lines (as the review holds them, edits included) against the entries of one day.
 * Pure: `existing` is that day's entries, and nothing is written.
 */
export function checkLines(lines: readonly Line[], existing: readonly ScanEntry[]): LineCheck[] {
  const resolved = resolveLines(lines, existing);
  return lines.map((line) => toCheck(line.id, resolved.get(line.id)!));
}

/** The checks of lines placed in slots (a day, or a month's lane), in the order given. Reads each slot once. */
export function checkPlaced(placed: readonly Placed[], reader: SlotReader): LineCheck[] {
  const resolved = resolveSlots(placed, reader);
  return placed.map(({ line }) => toCheck(line.id, resolved.get(line.id)!));
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

/** The page numbers a day already has paper for, ascending. */
export function pagesOf(entries: readonly ScanEntry[]): number[] {
  return [...new Set(entries.flatMap((entry) => (entry.page === null ? [] : [entry.page])))].sort((a, b) => a - b);
}

/**
 * The page a scan most likely shows: the existing page its lines match the most entries of (a rescan), else the next page after the
 * last one (a first scan of a new page), else 1. Entries not on paper do not count: a line that only matches one of those is no sign
 * of an earlier page.
 */
function suggestPage(placed: readonly Placed[], reader: SlotReader, pages: readonly number[]): number {
  const scores = pages.map((page) => {
    const resolved = resolveSlots(placed, pageReader(reader, page));
    return { page, score: [...resolved.values()].filter((resolution) => resolution.target?.page === page).length };
  });
  const best = scores.reduce((top, item) => (item.score > top.score ? item : top), { page: 0, score: 0 });
  if (best.score > 0) return best.page;
  return Math.min(MAX_PAPER_PAGE, pages.length > 0 ? pages[pages.length - 1] + 1 : 1);
}

/** The page and the existing pages a review starts with. Only a daily page has them: any other kind files on page 1. */
function pageChoice(kind: PageKind, date: string, placed: readonly Placed[], reader: SlotReader): { page: number; pages: number[] } {
  if (kind !== "daily") return { page: 1, pages: [] };
  const pages = pagesOf(reader.entries({ horizon: "day", date }));
  return { page: suggestPage(placed, reader, pages), pages };
}

/** The review a draft starts with for one kind (the detected one unless the person picked another). `reader` gives each slot's entries. */
export function startReview(draft: LogDraft, reader: SlotReader, kind: PageKind = draft.detected.kind): Review {
  const parsed = parsePage(draft.page, draft.fallbackDate, kind, draft.llm.period);
  const date = parsed.pageDate ?? draft.fallbackDate;
  const where: Where = { kind, date, month: parsed.month };
  const placed = parsed.lines.map((line) => ({ line, slot: slotOf(where, line) }));
  const { page, pages } = pageChoice(kind, date, placed, reader);
  const checks = checkPlaced(placed, pageReader(reader, page));
  return {
    id: draft.id,
    expires: draft.expires,
    kind,
    detected: draft.detected,
    date,
    pageDate: parsed.pageDate,
    fallbackDate: draft.fallbackDate,
    month: parsed.month,
    page,
    pages,
    items: parsed.lines.map((line, index) => ({ ...line, ...checks[index], include: startsIncluded(line, checks[index]) })),
  };
}
