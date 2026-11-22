import { ENTRY_HORIZONS, type EntryHorizon } from "./types.ts";

/** True for a horizon name the API knows. */
export function isEntryHorizon(value: unknown): value is EntryHorizon {
  return typeof value === "string" && (ENTRY_HORIZONS as readonly string[]).includes(value);
}

/** The last day of the month a valid YYYY-MM-DD falls in, as YYYY-MM-DD. */
export function lastDayOfMonth(date: string): string {
  const [year, month] = date.split("-").map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${date.slice(0, 7)}-${String(last).padStart(2, "0")}`;
}

/**
 * The date and type an entry is stored with for its horizon. A month or future entry hangs on the last day of its month
 * (that day is also its DUE), and an event needs a real day, so it becomes a task until a day is set.
 */
export function settleHorizon<T extends { date: string; type: string }>(entry: T, horizon: EntryHorizon): T {
  if (horizon === "day") return entry;
  return { ...entry, date: lastDayOfMonth(entry.date), type: entry.type === "event" ? "task" : entry.type };
}
