import { monthKey, nearestYear, type Heading, type MonthHeading } from "./months.ts";

/** A first month this many months or more behind the fallback month, with no year written, is read as next year's (January scanned in December). */
const ROLL_BEHIND = 3;

/** The year of a period (YYYY or YYYY-MM), or null. */
function periodYear(period: string | null): number | null {
  return period && /^\d{4}/.test(period) ? Number(period.slice(0, 4)) : null;
}

/** The year a future page names (a header, else the LLM's period), or null when the paper writes none. */
function writtenYear(headings: readonly Heading[], period: string | null): number | null {
  return headings.find((heading) => heading.year !== null)?.year ?? periodYear(period);
}

/** The year the first month of an unwritten-year page falls in: the fallback's year, or the next one for a month far behind it. */
function firstYear(firstMonth: number, fallbackDate: string): number {
  const year = Number(fallbackDate.slice(0, 4));
  return Number(fallbackDate.slice(5, 7)) - firstMonth >= ROLL_BEHIND ? year + 1 : year;
}

/**
 * The month (YYYY-MM) of each month heading of a future page, by heading index. A year written on a heading wins. Without one the
 * year starts at the header year (or the LLM's period), else the fallback's year (next year for a first month far behind it),
 * and goes up by one each time the month number falls from one heading to the next (November, December, January).
 */
export function monthsOfFuturePage(headings: readonly Heading[], period: string | null, fallbackDate: string): Map<number, string> {
  const months = headings.filter((heading): heading is MonthHeading => heading.type === "month");
  const named = writtenYear(headings, period);
  const out = new Map<number, string>();
  let year = named ?? (months.length > 0 ? firstYear(months[0].month, fallbackDate) : Number(fallbackDate.slice(0, 4)));
  let previous = 0;
  for (const heading of months) {
    if (heading.year !== null) year = heading.year;
    else if (heading.month < previous) year += 1;
    previous = heading.month;
    out.set(heading.index, monthKey(year, heading.month));
  }
  return out;
}

/** The month (YYYY-MM) of a calendar or month-task page: the heading's month, with its year, else the period's, else the nearest to the fallback. */
export function monthOfPage(heading: MonthHeading | null, period: string | null, fallbackDate: string): string {
  if (heading) return monthKey(heading.year ?? periodYear(period) ?? nearestYear(heading.month, fallbackDate), heading.month);
  if (period && /^\d{4}-\d{2}$/.test(period)) return period;
  return fallbackDate.slice(0, 7);
}
