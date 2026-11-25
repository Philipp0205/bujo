import { addDays } from "../../app-kit/time.ts";
import type { SlotReader } from "./plan.ts";

/** How many days before the fallback day a page with no date may continue: yesterday and the two days before. */
export const CONTINUE_WITHIN_DAYS = 3;

/** True when the day has at least one entry filed on a physical page. */
function hasPaper(reader: SlotReader, date: string): boolean {
  return reader.entries({ horizon: "day", date }).some((entry) => entry.page !== null);
}

/**
 * The day a page with no date header continues: the latest day before `fallback`, within the window, that already has paper
 * entries. Null when the fallback day itself has paper (it is that day's next page) or no earlier day in the window has any.
 * Pure: it only reads.
 */
export function continuedDay(fallback: string, reader: SlotReader, within: number = CONTINUE_WITHIN_DAYS): string | null {
  if (hasPaper(reader, fallback)) return null;
  for (let back = 1; back <= within; back += 1) {
    const date = addDays(fallback, -back);
    if (hasPaper(reader, date)) return date;
  }
  return null;
}
