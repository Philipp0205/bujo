import { addDays } from "../../app-kit/time.ts";
import { AMBIGUOUS_GAP, MATCH_THRESHOLD, matchKey } from "../../scan/match.ts";
import type { ScanEntry } from "../types.ts";
import { titleScore } from "./align.ts";
import type { Line } from "./types.ts";

/** How many days back a task written again on a later page may come from: the paper window of the migration review. */
export const CARRY_WINDOW_DAYS = 14;

/** Line types that carry a task over to a new page: an open task, or one already done there. */
const CARRY_TYPES: ReadonlySet<string> = new Set(["task", "done"]);

/** True when a line may be a task carried over from an earlier day. A line the person un-matched never is. */
export function canCarry(line: Line): boolean {
  return !line.unmatched && CARRY_TYPES.has(line.type) && matchKey(line.title) !== "";
}

/** The open daily tasks of the days in the paper window before `date`: not on a collection, not a month or future item. */
export function openBefore(entries: readonly ScanEntry[], date: string): ScanEntry[] {
  const from = addDays(date, -CARRY_WINDOW_DAYS);
  return entries.filter((entry) => entry.type === "task" && entry.horizon === "day" && entry.collectionId === null && entry.date >= from && entry.date < date);
}

/**
 * The one open task of an earlier day a line is that task written again, or undefined. The title must clear the same bar as the
 * day matcher, and two close candidates mean no link at all (the person decides). `claimed` holds the tasks other lines took. Pure.
 */
export function carriedFrom(line: Line, open: readonly ScanEntry[], claimed: ReadonlySet<string>): ScanEntry | undefined {
  const key = matchKey(line.title);
  const scored = open
    .filter((entry) => !claimed.has(entry.id))
    .map((entry) => ({ entry, score: titleScore(key, matchKey(entry.title)) }))
    .filter((item) => item.score >= MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return undefined;
  if (scored.length > 1 && scored[0].score - scored[1].score < AMBIGUOUS_GAP) return undefined;
  return scored[0].entry;
}
