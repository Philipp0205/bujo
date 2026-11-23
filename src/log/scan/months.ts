import { normalise } from "../../scan/match.ts";
import type { OcrLine } from "../../scan/ocr-client.ts";

/**
 * Month names as paper and OCR write them, German and English, after normalise() (lowercase, umlauts as ae oe ue,
 * punctuation gone). "März" arrives as "maerz", and "Marz" is what OCR makes of it without the dots.
 */
const MONTH_NAMES: Record<string, number> = {
  jan: 1, januar: 1, january: 1, jaenner: 1, janner: 1,
  feb: 2, februar: 2, february: 2,
  mar: 3, maerz: 3, marz: 3, march: 3, mrz: 3,
  apr: 4, april: 4,
  mai: 5, may: 5,
  jun: 6, juni: 6, june: 6,
  jul: 7, juli: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  okt: 10, oct: 10, oktober: 10, october: 10,
  nov: 11, november: 11,
  dez: 12, dec: 12, dezember: 12, december: 12,
};

/** The words that head a future log page. */
const FUTURE_WORDS = new Set(["future", "future log", "futurelog", "zukunft", "zukunftslog", "zukunfts log"]);

/** A heading line of a month, year or future page. A bare year or a "Future log" line is a "future" heading. */
export type MonthHeading = { index: number; type: "month"; month: number; year: number | null };
export type Heading = MonthHeading | { index: number; type: "future"; year: number | null };
type Named = Omit<MonthHeading, "index"> | { type: "future"; year: number | null };

const YEAR = /^(?:20)\d{2}$/;

/** A year written as 2026, or 26 (read as 2026, only 20 to 39 so "Juni 12" is not a year). Null for anything else. */
function toYear(word: string | undefined): number | null {
  if (word === undefined) return null;
  if (YEAR.test(word)) return Number(word);
  return /^[23]\d$/.test(word) ? 2000 + Number(word) : null;
}

/** "11 2026" (from 11.2026 or 11/2026): a month number and a four-digit year. */
function numericMonth(words: readonly string[]): { month: number; year: number } | null {
  if (words.length !== 2 || !/^\d{1,2}$/.test(words[0]) || !YEAR.test(words[1])) return null;
  const month = Number(words[0]);
  return month >= 1 && month <= 12 ? { month, year: Number(words[1]) } : null;
}

/** The month heading a text names (a month word, then an optional year), or null. */
function monthHeading(words: readonly string[]): Named | null {
  const numeric = numericMonth(words);
  if (numeric) return { type: "month", ...numeric };
  const month = MONTH_NAMES[words[0]];
  if (!month || words.length > 2) return null;
  const year = toYear(words[1]);
  return words.length === 2 && year === null ? null : { type: "month", month, year };
}

/** The future heading a text names ("2027", "Future log", "Zukunft 2027"), or null. */
function futureHeading(words: readonly string[]): Named | null {
  if (words.length === 1 && YEAR.test(words[0])) return { type: "future", year: Number(words[0]) };
  const last = words.at(-1);
  const year = last !== undefined && YEAR.test(last) ? Number(last) : null;
  const rest = (year === null ? words : words.slice(0, -1)).join(" ");
  return FUTURE_WORDS.has(rest) ? { type: "future", year } : null;
}

/** What a header text names: a month, or a year or "Future log", or null for any other text. */
export function parseHeading(text: string): Named | null {
  const words = normalise(text).split(" ").filter((word) => word !== "");
  if (words.length === 0 || words.length > 3) return null;
  return monthHeading(words) ?? futureHeading(words);
}

/** Every heading line of a page, in page order. Only a line with no bullet can be a heading. */
export function findHeadings(lines: ReadonlyArray<Pick<OcrLine, "symbol" | "text">>): Heading[] {
  const found: Heading[] = [];
  lines.forEach((line, index) => {
    const heading = line.symbol === "none" ? parseHeading(line.text) : null;
    if (heading) found.push({ ...heading, index });
  });
  return found;
}

/** The first of a month as YYYY-MM. */
export const monthKey = (year: number, month: number): string => `${year}-${String(month).padStart(2, "0")}`;

/** The year whose month is closest to the fallback date: a page of May scanned in November is May of this year. */
export function nearestYear(month: number, fallbackDate: string): number {
  const fallbackYear = Number(fallbackDate.slice(0, 4));
  const fallbackIndex = fallbackYear * 12 + Number(fallbackDate.slice(5, 7));
  const distance = (year: number): number => Math.abs(year * 12 + month - fallbackIndex);
  return [fallbackYear, fallbackYear + 1, fallbackYear - 1].reduce((best, year) => (distance(year) < distance(best) ? year : best));
}
