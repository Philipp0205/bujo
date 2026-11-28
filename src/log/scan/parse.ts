import { correctWords } from "../../scan/match.ts";
import type { OcrLine, OcrSymbol } from "../../scan/ocr-client.ts";
import type { EntrySection, EntryType } from "../types.ts";
import { parseMarkup } from "../markup.ts";
import { isWeekdayOnly, parseDayRow } from "./calendar.ts";
import { monthOfPage, monthsOfFuturePage } from "./future.ts";
import { parseHeaderDate } from "./header.ts";
import { findHeadings, type Heading } from "./months.ts";
import { findSections, sectionOf } from "./sections.ts";
import type { PageKind } from "./types.ts";

/** The bullet of each OCR symbol as a log entry type. A line with no bullet is read as a note. */
const SYMBOL_TYPES: Record<OcrSymbol, EntryType> = {
  "•": "task",
  "–": "note",
  "○": "event",
  x: "done",
  ">": "migrated",
  "<": "scheduled",
  "~": "dropped",
  none: "note",
};

/** The part of an OCR line the parser reads. The box is not needed, so a draft can keep lines without it. */
export type PageLine = Pick<OcrLine, "symbol" | "text" | "confidence" | "indent">;

/** One scanned line, as the review starts from it. */
export type ParsedLine = {
  id: string;
  type: EntryType;
  title: string;
  /** The #tags written in the line, in order. They are cut out of the title. */
  tags: string[];
  /** A time written in the line (HH:MM), or null. It is cut out of the title. */
  time: string | null;
  /** True when the line starts with the handwritten * signifier (cut out of the title). */
  important: boolean;
  /** What the OCR read, 0..1. */
  confidence: number;
  /** True for a line with no bullet: it may be a stray mark, so the review leaves it off by default. */
  noBullet: boolean;
  /** 1 when the line is nested under the entry above it (daily pages only), else 0. */
  indent: 0 | 1;
  /** Future page only: the month (YYYY-MM) the line sits under. */
  month?: string;
  /** Calendar page only: the day of the month the line sits on, or null when the page gave it none. */
  day?: number | null;
  /** Month-task page only: the section (work or private) the line sits under, or null when no section heading is above it. */
  section?: EntrySection | null;
};

export type ParsedPage = {
  kind: PageKind;
  /** The date the page header names (daily pages), or null when no header line parsed. */
  pageDate: string | null;
  /** The month (YYYY-MM) of a calendar or month-task page, else null. */
  month: string | null;
  lines: ParsedLine[];
};

/** The header date of the first symbol-less line that parses, with that line's index. */
function findHeader(lines: readonly PageLine[], fallbackDate: string): { date: string; index: number } | null {
  for (let index = 0; index < lines.length; index++) {
    if (lines[index].symbol !== "none") continue;
    const date = parseHeaderDate(lines[index].text, fallbackDate);
    if (date) return { date, index };
  }
  return null;
}

/** A leading handwritten * (the important signifier), with a bullet dot that may follow it. A ** or a * inside the text is not one. */
const IMPORTANT_PREFIX = /^\*(?!\*)\s*(?:[•·]\s*)?/;

/** Splits the important * off the front of a line's text. The bullet type is not touched. */
function takeImportant(text: string): { text: string; important: boolean } {
  const rest = text.replace(IMPORTANT_PREFIX, "");
  return { text: rest, important: rest !== text };
}

/**
 * One OCR line as an entry draft: the bullet gives the type, a leading * marks it important, known misreadings are corrected,
 * then written #tags and a time are cut out of the title. An "@..." word stays in the title: the review has no date field per line.
 */
function toParsedLine(line: PageLine, index: number): ParsedLine {
  const { text, important } = takeImportant(line.text.trim());
  const markup = parseMarkup(correctWords(text), { final: true, dates: false });
  return {
    id: `l${index + 1}`,
    type: SYMBOL_TYPES[line.symbol],
    title: markup.title,
    tags: markup.tags,
    time: markup.time,
    important,
    confidence: line.confidence,
    noBullet: line.symbol === "none",
    indent: 0,
  };
}

/** A month or future entry has no day to hang an event on, so it is read as a task (the same rule the store applies on write). */
function asMonthLine(line: ParsedLine): ParsedLine {
  return line.type === "event" ? { ...line, type: "task" } : line;
}

/** The lines of a page with the heading lines taken out. Ids keep the page order, so they stay put. */
function bodyLines(lines: readonly PageLine[], headings: readonly Heading[]): Array<{ line: PageLine; index: number }> {
  const skip = new Set(headings.map((heading) => heading.index));
  return lines.map((line, index) => ({ line, index })).filter(({ index }) => !skip.has(index));
}

function parseDaily(lines: readonly PageLine[], fallbackDate: string): ParsedPage {
  const header = findHeader(lines, fallbackDate);
  const parsed = lines.map((line, index) => ({ ...toParsedLine(line, index), indent: indentOf(lines, index, header?.index ?? null) })).filter((_, index) => index !== header?.index);
  return { kind: "daily", pageDate: header?.date ?? null, month: null, lines: parsed };
}

/**
 * A daily line nests (1) only when the OCR says so and the line right above it on the page is an entry line (it has a bullet and is not
 * the date header). Anything else, the first line included, stays 0. Deeper writing is already one level in the OCR answer.
 */
function indentOf(lines: readonly PageLine[], index: number, headerIndex: number | null): 0 | 1 {
  const parent = lines[index - 1];
  if (lines[index].indent !== 1 || !parent || parent.symbol === "none" || index - 1 === headerIndex) return 0;
  return 1;
}

/** A month's task page: the lines under one month heading, with no day. A Work or Private heading is not an entry: the lines below it carry that section. */
function parseMonthTask(lines: readonly PageLine[], fallbackDate: string, period: string | null): ParsedPage {
  const headings = findHeadings(lines);
  const sections = findSections(lines);
  const first = headings.find((heading) => heading.type === "month") ?? null;
  const month = monthOfPage(first, period, fallbackDate);
  const parsed = bodyLines(lines, headings)
    .filter(({ index }) => !sections.has(index))
    .map(({ line, index }) => ({ ...asMonthLine(toParsedLine(line, index)), section: sectionOf(index, sections) }));
  return { kind: "month-task", pageDate: null, month, lines: parsed };
}

/** The month a future line falls under: that of the nearest heading above it, else the first heading below, else the fallback month. */
function futureMonthOf(index: number, headings: readonly Heading[], months: Map<number, string>, fallbackDate: string): string {
  const monthHeadings = headings.filter((heading) => months.has(heading.index));
  const above = monthHeadings.filter((heading) => heading.index < index).at(-1);
  const heading = above ?? monthHeadings[0];
  return heading ? months.get(heading.index)! : fallbackDate.slice(0, 7);
}

/** A future page: each line goes under the month heading above it. A leading day number stays in the title. */
function parseFuture(lines: readonly PageLine[], fallbackDate: string, period: string | null): ParsedPage {
  const headings = findHeadings(lines);
  const months = monthsOfFuturePage(headings, period, fallbackDate);
  const parsed = bodyLines(lines, headings).map(({ line, index }) => ({
    ...asMonthLine(toParsedLine(line, index)),
    month: futureMonthOf(index, headings, months, fallbackDate),
  }));
  return { kind: "future", pageDate: null, month: null, lines: parsed };
}

/** One calendar line: a day row gives its day and text (a row with no bullet is an event of that day), any other line stays on the day above. */
function toCalendarLine(line: PageLine, index: number, lastDay: number | null): ParsedLine {
  const row = parseDayRow(line, false);
  if (!row) return { ...toParsedLine(isWeekdayOnly(line.text) ? { ...line, text: "" } : line, index), day: lastDay };
  const parsed = toParsedLine({ ...line, text: row.text }, index);
  return { ...parsed, type: line.symbol === "none" ? "event" : parsed.type, noBullet: false, day: row.day };
}

/** A calendar page: day rows with the weekday letters stripped. Empty days (a number and a weekday, no text) are dropped, and a line with no day number stays on the day above. */
function parseCalendar(lines: readonly PageLine[], fallbackDate: string, period: string | null): ParsedPage {
  const headings = findHeadings(lines);
  const first = headings.find((heading) => heading.type === "month") ?? null;
  const parsed: ParsedLine[] = [];
  let lastDay: number | null = null;
  for (const { line, index } of bodyLines(lines, headings)) {
    const next = toCalendarLine(line, index, lastDay);
    lastDay = next.day ?? lastDay;
    if (next.title !== "") parsed.push(next);
  }
  return { kind: "calendar", pageDate: null, month: monthOfPage(first, period, fallbackDate), lines: parsed };
}

/**
 * Turns the OCR lines of a log page into entry drafts for one page kind. Daily is the default. Heading lines (the date, a
 * month, a year) are not entries. Line ids follow the page order (l1, l2, ...) and stay put when heading lines are dropped.
 */
export function parsePage(lines: readonly PageLine[], fallbackDate: string, kind: PageKind = "daily", period: string | null = null): ParsedPage {
  if (kind === "future") return parseFuture(lines, fallbackDate, period);
  if (kind === "calendar") return parseCalendar(lines, fallbackDate, period);
  if (kind === "month-task") return parseMonthTask(lines, fallbackDate, period);
  return parseDaily(lines, fallbackDate);
}
