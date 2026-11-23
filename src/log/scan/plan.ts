import { MATCH_THRESHOLD, matchKey, similarity } from "../../scan/match.ts";
import { isValidDate } from "../validation.ts";
import { lastDayOfMonth } from "../horizon.ts";
import type { Entry, ScanEntry, Trace } from "../types.ts";
import { NEW, resolveLines } from "./resolve.ts";
import type { Line, PageKind, Resolution, Slot } from "./types.ts";

/** What a page is filed under: its kind, the day of a daily page, the month of a calendar or month-task page. */
export type Where = { kind: PageKind; date: string; month: string | null };

/** The position fields a line may carry beyond what the matcher reads: a calendar day, a future month. */
export type Position = { day?: number | null; month?: string | null };

/** A line with the slot it files in. A null slot means the line cannot be placed (a calendar line with no real day). */
export type Placed = { line: Line; slot: Slot | null };

/** A resolution that may say a trace on the old page matched the line. */
export type Planned = Resolution & { traced?: boolean };

/** Reads what is on a slot: its entries (with scan provenance) and the traces left on it. Reads are made once per slot. */
export type SlotReader = {
  entries(slot: Slot): ScanEntry[];
  traces(slot: Slot): Trace[];
};

/** A slot's key, for grouping lines. */
const keyOf = (slot: Slot): string => `${slot.horizon}|${slot.date}`;

/** The last day of a YYYY-MM month as the date a month entry hangs on. */
const monthDate = (month: string): string => lastDayOfMonth(`${month}-01`);

/** True for a YYYY-MM string that is a real month. */
export const isMonth = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}$/.test(value) && isValidDate(`${value}-01`);

/** The day entry a calendar day names in a month, or null when the month has no such day. */
function calendarSlot(month: string | null, day: number | null | undefined): Slot | null {
  if (!isMonth(month) || !day) return null;
  const date = `${month}-${String(day).padStart(2, "0")}`;
  return isValidDate(date) ? { horizon: "day", date } : null;
}

/** The slot a line files in, by the page kind: a day, a day of the month, the month's task lane or a future month's lane. */
export function slotOf(where: Where, position: Position): Slot | null {
  if (where.kind === "daily") return { horizon: "day", date: where.date };
  if (where.kind === "calendar") return calendarSlot(where.month, position.day);
  if (where.kind === "month-task") return isMonth(where.month) ? { horizon: "month-task", date: monthDate(where.month) } : null;
  return isMonth(position.month) ? { horizon: "future", date: monthDate(position.month) } : null;
}

/** Groups placed lines by slot, keeping page order inside each group. Lines with no slot are left out. */
function groupBySlot(placed: readonly Placed[]): Map<string, { slot: Slot; lines: Line[] }> {
  const groups = new Map<string, { slot: Slot; lines: Line[] }>();
  for (const { line, slot } of placed) {
    if (!slot) continue;
    const group = groups.get(keyOf(slot)) ?? { slot, lines: [] };
    group.lines.push(line);
    groups.set(keyOf(slot), group);
  }
  return groups;
}

/** Title similarity both ways, like the entry matcher: a short line against a long title, and the reverse. */
function titleScore(a: string, b: string): number {
  return Math.max(similarity(a, b), similarity(b, a));
}

/** The unclaimed trace of the same kind whose title best matches the line, or undefined when none is close enough. */
function bestTrace(line: Line, traces: readonly Trace[], claimed: Set<string>): Trace | undefined {
  const key = matchKey(line.title);
  if (key === "") return undefined;
  const scored = traces
    .filter((trace) => !claimed.has(trace.id) && trace.kind === line.type)
    .map((trace) => ({ trace, score: titleScore(key, matchKey(trace.title)) }))
    .filter((item) => item.score >= MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.trace;
}

/**
 * A ">" or "<" line with no entry of its own is often the trace a move left on this page: the paper shows where the entry went.
 * Such a line is unchanged with no target (nothing to stamp or write). Each trace answers one line.
 */
function matchTraces(lines: readonly Line[], resolved: Map<string, Planned>, traces: readonly Trace[]): void {
  const claimed = new Set<string>();
  for (const line of lines) {
    if (resolved.get(line.id)?.status !== "new" || (line.type !== "migrated" && line.type !== "scheduled")) continue;
    const trace = bestTrace(line, traces, claimed);
    if (!trace) continue;
    claimed.add(trace.id);
    resolved.set(line.id, { ...NEW, status: "unchanged", traced: true });
  }
}

/** Decides the lines of one slot against that slot's entries, then against its traces. */
function resolveGroup(slot: Slot, lines: readonly Line[], reader: SlotReader): Map<string, Planned> {
  const resolved: Map<string, Planned> = resolveLines(lines, reader.entries(slot));
  matchTraces(lines, resolved, reader.traces(slot));
  return resolved;
}

/**
 * Decides every placed line against the entries of its own slot (horizon and date), in page order inside the slot. An entry no
 * line matches is left out: nothing is deleted. A line with no slot is new. Pure: it reads, it never writes.
 */
export function resolveSlots(placed: readonly Placed[], reader: SlotReader): Map<string, Planned> {
  const out = new Map<string, Planned>();
  for (const { slot, lines } of groupBySlot(placed).values()) {
    for (const [id, resolution] of resolveGroup(slot, lines, reader)) out.set(id, resolution);
  }
  for (const { line, slot } of placed) if (!slot) out.set(line.id, NEW);
  return out;
}

/** A reader over fixed lists, for a pure test or a single-slot check. Entries and traces are filtered to the slot asked for. */
export function fixedReader(entries: readonly ScanEntry[], traces: readonly Trace[] = []): SlotReader {
  const same = (item: Pick<Entry, "date" | "horizon">, slot: Slot): boolean => item.date === slot.date && item.horizon === slot.horizon;
  return { entries: (slot) => entries.filter((entry) => same(entry, slot)), traces: (slot) => traces.filter((trace) => same(trace, slot)) };
}
