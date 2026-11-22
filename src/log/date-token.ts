/**
 * Written dates in an entry line ("@morgen", "@mo", "@23.11."). The canonical reader: public/js/log/date-token.js is its
 * browser twin and must behave the same (test/log-markup.test.ts runs both over one corpus). Pure: `today` is passed in.
 *
 * Grammar of a date word (case-insensitive, no spaces):
 *   @heute, @morgen, @übermorgen (also @uebermorgen)   today, +1 day, +2 days
 *   @montag @dienstag @mittwoch @donnerstag @freitag @samstag @sonnabend @sonntag
 *   @mo @di @mi @do @fr @sa @so                         the next such weekday, today included ("@mo." is plain text)
 *   @dd.mm  @dd.mm.  @d.m                               this year, or next year when that day has passed (today has not)
 *   @dd.mm.yyyy                                         that day, which must be a real date with a 4 digit year
 *   @dezember @dez @december @dec ... @märz @maerz      a whole month (German or English name, short or long): this year,
 *                                                       or next year when that month has passed (this month has not)
 *   @mm.yyyy (e.g. @12.2026)                            that month of that year. A bare @12 is not a month: it stays text
 * A day that does not exist ("@31.02.", "@29.02." outside a leap year) is plain text. "@mo" is Monday, never a month.
 */

const DAY_MS = 86_400_000;
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const NUMERIC = /^@(\d{1,2})\.(\d{1,2})\.?$/;
const NUMERIC_YEAR = /^@(\d{1,2})\.(\d{1,2})\.(\d{4})$/;
const NUMERIC_MONTH = /^@(\d{1,2})\.(\d{4})$/;

/** Days from today for the relative words. */
const RELATIVE: Record<string, number> = { heute: 0, morgen: 1, übermorgen: 2, uebermorgen: 2 };

/** Weekday (0 = Sunday) for each written name and short name. */
const WEEKDAY: Record<string, number> = {
  mo: 1, montag: 1, di: 2, dienstag: 2, mi: 3, mittwoch: 3, do: 4, donnerstag: 4,
  fr: 5, freitag: 5, sa: 6, samstag: 6, sonnabend: 6, so: 0, sonntag: 0,
};

/** Month number (1 to 12) for each written name and short name, English and German, lower case. */
const MONTH: Record<string, number> = {
  january: 1, jan: 1, januar: 1, february: 2, feb: 2, februar: 2,
  march: 3, mar: 3, maerz: 3, märz: 3, maer: 3, april: 4, apr: 4,
  may: 5, mai: 5, june: 6, jun: 6, juni: 6, july: 7, jul: 7, juli: 7,
  august: 8, aug: 8, september: 9, sep: 9, sept: 9,
  october: 10, oct: 10, oktober: 10, okt: 10, november: 11, nov: 11,
  december: 12, dec: 12, dezember: 12, dez: 12,
};

/** The YYYY-MM-DD of a UTC time stamp. */
function isoOf(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

/** The UTC time stamp of a YYYY-MM-DD. */
function timeOf(iso: string): number {
  const match = ISO.exec(iso)!;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** `iso` moved by whole days. */
export function addDays(iso: string, days: number): string {
  return isoOf(timeOf(iso) + days * DAY_MS);
}

/** YYYY-MM-DD for a year, month and day, or null when that day does not exist. */
function realDate(year: number, month: number, day: number): string | null {
  const time = Date.UTC(year, month - 1, day);
  const date = new Date(time);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return isoOf(time);
}

/** The next day with this weekday, today included. */
function nextWeekday(today: string, weekday: number): string {
  const now = new Date(timeOf(today)).getUTCDay();
  return addDays(today, (weekday - now + 7) % 7);
}

/** A day and month with no year: this year, else next year when this year's has passed or does not exist. */
function yearless(today: string, month: number, day: number): string | null {
  const year = Number(today.slice(0, 4));
  const thisYear = realDate(year, month, day);
  if (thisYear !== null && thisYear >= today) return thisYear;
  return realDate(year + 1, month, day);
}

/** The day a word writes ("@morgen", "@mo", "@23.11."), or null when it is not a date word. */
export function dateOf(word: string, today: string): string | null {
  const full = NUMERIC_YEAR.exec(word);
  if (full) return realDate(Number(full[3]), Number(full[2]), Number(full[1]));
  const short = NUMERIC.exec(word);
  if (short) return yearless(today, Number(short[2]), Number(short[1]));
  if (!word.startsWith("@")) return null;
  const name = word.slice(1).toLowerCase();
  if (Object.hasOwn(RELATIVE, name)) return addDays(today, RELATIVE[name]);
  if (Object.hasOwn(WEEKDAY, name)) return nextWeekday(today, WEEKDAY[name]);
  return null;
}

/** YYYY-MM for a year and a month 1 to 12. */
function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** The month a word writes ("@dez", "@december", "@12.2026") as YYYY-MM, or null when it is not a month word. */
export function monthOf(word: string, today: string): string | null {
  if (!word.startsWith("@")) return null;
  const year = Number(today.slice(0, 4));
  const numeric = NUMERIC_MONTH.exec(word);
  if (numeric) return Number(numeric[1]) >= 1 && Number(numeric[1]) <= 12 ? monthKey(Number(numeric[2]), Number(numeric[1])) : null;
  const name = word.slice(1).toLowerCase();
  if (!Object.hasOwn(MONTH, name)) return null;
  const month = MONTH[name];
  return monthKey(month < Number(today.slice(5, 7)) ? year + 1 : year, month);
}

