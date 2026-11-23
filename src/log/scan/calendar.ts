import type { OcrLine } from "../../scan/ocr-client.ts";

/**
 * Weekday tokens a calendar page writes after the day number: German and English short names and full names, and the
 * single capital letters of a column of day initials. Compared lowercase, except a single letter, which must be a capital.
 */
const WEEKDAY_WORDS = new Set([
  "mo", "di", "mi", "do", "fr", "sa", "so",
  "mon", "tue", "tues", "wed", "thu", "thur", "thurs", "fri", "sat", "sun",
  "montag", "dienstag", "mittwoch", "donnerstag", "freitag", "samstag", "sonntag",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
]);
const WEEKDAY_INITIALS = new Set(["M", "D", "T", "W", "F", "S"]);

/** A day number (1 to 31), an optional dot, colon or bracket, then the rest of the line. */
const DAY_ROW = /^\s*(\d{1,2})(?:\s*[.:)]\s*|\s+|$)(.*)$/;

/** One line of a calendar page as it reads: its day number, the text left after weekday tokens, and whether a weekday token stood there. */
export type DayRow = { day: number; text: string; weekday: boolean };

function isWeekdayToken(word: string): boolean {
  return WEEKDAY_INITIALS.has(word) || WEEKDAY_WORDS.has(word.toLowerCase().replace(/\.$/, ""));
}

/** The text with one leading weekday token cut off (and its dot), and whether there was one. A token must stand alone: "S-Bahn" is no token. */
function stripWeekday(text: string): { text: string; weekday: boolean } {
  const match = /^(\S+?)\.?(?:\s+|$)/.exec(text.trimStart());
  if (!match || !isWeekdayToken(match[1])) return { text: text.trim(), weekday: false };
  return { text: text.trimStart().slice(match[0].length).trim(), weekday: true };
}

/**
 * Reads a line as a calendar day row: a day number, then weekday tokens, then the text. Strict (for detecting a calendar page)
 * needs a weekday token or no bullet, so a task "2 Eier kaufen" does not make a page a calendar. Lenient (once the page is known
 * to be a calendar) takes any leading day number. A day past 31, or a number followed by a number (a date), is no day row.
 */
export function parseDayRow(line: Pick<OcrLine, "symbol" | "text">, strict = true): DayRow | null {
  const match = DAY_ROW.exec(line.text);
  if (!match) return null;
  const day = Number(match[1]);
  if (day < 1 || day > 31) return null;
  const rest = stripWeekday(match[2]);
  if (/^\d/.test(rest.text)) return null;
  if (strict && !rest.weekday && (line.symbol !== "none" || rest.text === "")) return null;
  return { day, text: rest.text, weekday: rest.weekday };
}

/** True for text that is only weekday tokens ("Mo", "Di."): a column letter with no day number. */
export function isWeekdayOnly(text: string): boolean {
  const rest = stripWeekday(text);
  return rest.weekday && rest.text === "";
}

/** How many day rows climb in page order (each day above the one before it). A calendar page climbs; other pages seldom do. */
export function countAscendingDays(lines: ReadonlyArray<Pick<OcrLine, "symbol" | "text">>): number {
  let last = 0;
  let count = 0;
  for (const line of lines) {
    const row = parseDayRow(line);
    if (row && row.day > last) {
      count += 1;
      last = row.day;
    }
  }
  return count;
}
