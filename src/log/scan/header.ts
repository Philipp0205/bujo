import { isCalendarDate } from "../../app-kit/time.ts";
import { OCR_DIGITS, parseDateLine } from "../../scan/draft.ts";

/** "Friday 20.11", "20.11." or "20.11": an optional weekday word, then day and month, and nothing else on the line. */
const SHORT_DATE = /^\s*(?:[A-Za-z\u00c4\u00d6\u00dc\u00e4\u00f6\u00fc\u00df]{2,12}\.?,?\s*)?([\dOoQIl|SB]{1,2})\s*[.,]\s*([\dOoQIl|SB]{1,2})\s*\.?\s*$/;

const digits = (text: string): string => text.replace(/[OoQIl|SB]/g, (ch) => OCR_DIGITS[ch] ?? ch);

/** A day and month with no year, completed with the year of `fallbackDate`. Null when it is not a real day. */
function parseShortDate(text: string, fallbackDate: string): string | null {
  const match = SHORT_DATE.exec(text);
  if (!match) return null;
  const day = digits(match[1]).padStart(2, "0");
  const month = digits(match[2]).padStart(2, "0");
  const iso = `${fallbackDate.slice(0, 4)}-${month}-${day}`;
  return isCalendarDate(iso) ? iso : null;
}

/**
 * The day a page header line names, as YYYY-MM-DD, or null when the line is no date.
 * Full dates reuse the backlog scan's parser (20.11.2026, OCR noise tolerated). A date without a year takes the
 * year of `fallbackDate`.
 */
export function parseHeaderDate(text: string, fallbackDate: string): string | null {
  return parseDateLine(text) ?? parseShortDate(text, fallbackDate);
}
