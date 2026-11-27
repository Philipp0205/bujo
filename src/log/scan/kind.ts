import type { OcrLine } from "../../scan/ocr-client.ts";
import { countAscendingDays } from "./calendar.ts";
import { parseHeaderDate } from "./header.ts";
import { findHeadings } from "./months.ts";
import { isPageKind, type PageKind, type ViewHint } from "./types.ts";

/** Where a detected kind came from: what the LLM said, what the page itself shows, the view the person had open, or nothing (daily). */
export type KindSource = "llm" | "page" | "view" | "default";

export type Detected = { kind: PageKind; source: KindSource };

/** The kind each log view prefers when the page says nothing clear. */
const VIEW_KINDS: Record<ViewHint, PageKind> = { daily: "daily", future: "future", month: "month-task" };

/** A calendar page lists at least this many day rows in climbing order. Fewer is a task list that happens to start with numbers. */
const CALENDAR_MIN_DAYS = 3;

type PageLine = Pick<OcrLine, "symbol" | "text">;

/** True when a line with no bullet is a full date header (20.11.2026, Friday 20.11). */
function hasDateHeader(lines: readonly PageLine[], fallbackDate: string): boolean {
  return lines.some((line) => line.symbol === "none" && parseHeaderDate(line.text, fallbackDate) !== null);
}

/** The kind the page itself shows with confidence, or null. Two months or a year header: future. A date header: daily. One month: calendar with day rows, else month tasks. */
function strongKind(lines: readonly PageLine[], fallbackDate: string): PageKind | null {
  const headings = findHeadings(lines);
  const months = headings.filter((heading) => heading.type === "month").length;
  if (months >= 2 || headings.some((heading) => heading.type === "future")) return "future";
  if (hasDateHeader(lines, fallbackDate)) return "daily";
  if (months === 1) return countAscendingDays(lines) >= CALENDAR_MIN_DAYS ? "calendar" : "month-task";
  return null;
}

/** A hint with less to go on: day rows climbing with no heading read as a calendar. */
function weakKind(lines: readonly PageLine[]): PageKind | null {
  return countAscendingDays(lines) >= CALENDAR_MIN_DAYS ? "calendar" : null;
}

/** True when the page itself shows log structure: a date or month heading, a future heading, or climbing day rows. */
export function showsLogStructure(lines: readonly PageLine[], fallbackDate: string): boolean {
  return strongKind(lines, fallbackDate) !== null || weakKind(lines) !== null;
}

/**
 * Names the kind of a page. A valid LLM kind decides, then a strong signal on the page, then the view the person had open,
 * then a weak signal, then daily. The result is a guess: the review shows it and lets the person change it.
 */
export function detectKind(lines: readonly PageLine[], hint: ViewHint | null, fallbackDate: string, llmKind?: string | null): Detected {
  if (isPageKind(llmKind)) return { kind: llmKind, source: "llm" };
  const strong = strongKind(lines, fallbackDate);
  if (strong) return { kind: strong, source: "page" };
  if (hint) return { kind: VIEW_KINDS[hint], source: "view" };
  const weak = weakKind(lines);
  return weak ? { kind: weak, source: "page" } : { kind: "daily", source: "default" };
}
