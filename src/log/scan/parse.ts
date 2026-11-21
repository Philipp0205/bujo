import { correctWords } from "../../scan/match.ts";
import type { OcrLine, OcrSymbol } from "../../scan/ocr-client.ts";
import type { EntryType } from "../types.ts";
import { parseMarkup } from "../markup.ts";
import { parseHeaderDate } from "./header.ts";

/** The bullet of each OCR symbol as a log entry type. A line with no bullet is read as a note. */
const SYMBOL_TYPES: Record<OcrSymbol, EntryType> = {
  "•": "task",
  "–": "note",
  "○": "event",
  x: "done",
  ">": "migrated",
  "<": "scheduled",
  none: "note",
};

/** One scanned line, as the review starts from it. */
export type ParsedLine = {
  id: string;
  type: EntryType;
  title: string;
  /** The #tags written in the line, in order. They are cut out of the title. */
  tags: string[];
  /** A time written in the line (HH:MM), or null. It is cut out of the title. */
  time: string | null;
  /** What the OCR read, 0..1. */
  confidence: number;
  /** True for a line with no bullet: it may be a stray mark, so the review leaves it off by default. */
  noBullet: boolean;
};

export type ParsedPage = {
  /** The date the page header names, or null when no header line parsed. */
  pageDate: string | null;
  lines: ParsedLine[];
};

/** The header date of the first symbol-less line that parses, with that line's index. */
function findHeader(lines: readonly OcrLine[], fallbackDate: string): { date: string; index: number } | null {
  for (let index = 0; index < lines.length; index++) {
    if (lines[index].symbol !== "none") continue;
    const date = parseHeaderDate(lines[index].text, fallbackDate);
    if (date) return { date, index };
  }
  return null;
}

/**
 * One OCR line as an entry draft: the bullet gives the type, known misreadings are corrected, then written #tags and a time
 * are cut out of the title. An "@..." word stays in the title: the review has no date field per line.
 */
function toParsedLine(line: OcrLine, index: number): ParsedLine {
  const markup = parseMarkup(correctWords(line.text.trim()), { final: true, dates: false });
  return {
    id: `l${index + 1}`,
    type: SYMBOL_TYPES[line.symbol],
    title: markup.title,
    tags: markup.tags,
    time: markup.time,
    confidence: line.confidence,
    noBullet: line.symbol === "none",
  };
}

/**
 * Turns the OCR lines of a rapid-log page into entry drafts. The header line (a date) is not an entry.
 * Line ids follow the page order (l1, l2, ...) and stay put when the header line is dropped.
 */
export function parsePage(lines: readonly OcrLine[], fallbackDate: string): ParsedPage {
  const header = findHeader(lines, fallbackDate);
  const parsed = lines.map(toParsedLine).filter((_, index) => index !== header?.index);
  return { pageDate: header?.date ?? null, lines: parsed };
}
