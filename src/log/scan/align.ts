import { AMBIGUOUS_GAP, MATCH_THRESHOLD, matchKey, similarity } from "../../scan/match.ts";
import type { EntryType, ScanEntry } from "../types.ts";
import type { Line } from "./types.ts";

/** Task-family symbols that a change of symbol moves between: task, done, migrated, scheduled, dropped. */
const RELATED_TYPES: ReadonlySet<EntryType> = new Set<EntryType>(["task", "done", "migrated", "scheduled", "dropped"]);
/** How much a shared type and a nearby position add to a title score. Titles decide, these only break ties. */
const TYPE_WEIGHT = 0.12;
const POSITION_WEIGHT = 0.05;
/** Unrelated types (a task and an event) bind only when the titles are this close. */
const NEAR_EXACT = 0.9;

type Slot = { line: Line; key: string; index: number };
type Pool = { entries: readonly ScanEntry[]; keys: Map<string, string>; claimed: Set<string>; bound: Map<string, ScanEntry> };

/** 1 for the same type, 0.4 for two task-family types (a symbol change), else 0. */
function typeAffinity(a: EntryType, b: EntryType): number {
  if (a === b) return 1;
  return RELATED_TYPES.has(a) && RELATED_TYPES.has(b) ? 0.4 : 0;
}

/** 1 next to the same place on the day, falling off with the distance. */
function proximity(index: number, entry: ScanEntry): number {
  return 1 / (1 + Math.abs(index - entry.position));
}

/** Binds one line to one entry. The entry is then out of reach for every other line. */
function bind(pool: Pool, slot: Slot, entry: ScanEntry): void {
  pool.claimed.add(entry.id);
  pool.bound.set(slot.line.id, entry);
}

/** Unclaimed entries whose key equals the line's key, best first: the same type, then the nearest position. */
function exactCandidates(slot: Slot, pool: Pool, keyOf: (entry: ScanEntry) => string): ScanEntry[] {
  return pool.entries
    .filter((entry) => !pool.claimed.has(entry.id) && keyOf(entry) === slot.key)
    .sort((a, b) => typeAffinity(slot.line.type, b.type) - typeAffinity(slot.line.type, a.type) || proximity(slot.index, b) - proximity(slot.index, a));
}

/** One exact pass over the lines in page order: each takes its best unclaimed entry with the same key. */
function exactPass(slots: readonly Slot[], pool: Pool, keyOf: (entry: ScanEntry) => string): void {
  for (const slot of slots) {
    if (pool.bound.has(slot.line.id)) continue;
    const [best] = exactCandidates(slot, pool, keyOf);
    if (best) bind(pool, slot, best);
  }
}

/** Title similarity both ways: similarity() credits a short line against a long title, and a title reworded longer on paper is the reverse. */
function titleScore(a: string, b: string): number {
  return Math.max(similarity(a, b), similarity(b, a));
}

/** The fuzzy score of a line against an entry, or null when the titles are too far apart or the types too unrelated. */
function fuzzyScore(slot: Slot, entry: ScanEntry, pool: Pool): number | null {
  const stored = entry.scan?.key ?? "";
  const text = Math.max(titleScore(slot.key, pool.keys.get(entry.id)!), stored === "" ? 0 : titleScore(slot.key, stored));
  if (text < MATCH_THRESHOLD) return null;
  const affinity = typeAffinity(slot.line.type, entry.type);
  if (affinity === 0 && text < NEAR_EXACT) return null;
  return text + TYPE_WEIGHT * affinity + POSITION_WEIGHT * proximity(slot.index, entry);
}

/** The unclaimed entries a line may bind to by fuzzy title, best score first. */
function fuzzyCandidates(slot: Slot, pool: Pool): Array<{ entry: ScanEntry; score: number }> {
  const scored: Array<{ entry: ScanEntry; score: number }> = [];
  for (const entry of pool.entries) {
    if (pool.claimed.has(entry.id) || pool.keys.get(entry.id) === "") continue;
    const score = fuzzyScore(slot, entry, pool);
    if (score !== null) scored.push({ entry, score });
  }
  return scored.sort((a, b) => b.score - a.score);
}

/** Every line and free entry that clear the threshold, best score first, ties in page order. */
function fuzzyPairs(slots: readonly Slot[], pool: Pool): Array<{ slot: Slot; entry: ScanEntry; score: number }> {
  const pairs = slots.flatMap((slot) => fuzzyCandidates(slot, pool).map(({ entry, score }) => ({ slot, entry, score })));
  return pairs.sort((a, b) => b.score - a.score || a.slot.index - b.slot.index);
}

/** True when another unbound line ranks this entry first: it is that line's pick, so it is no rival for this one. */
function isPickOfOther(entry: ScanEntry, slot: Slot, slots: readonly Slot[], pool: Pool): boolean {
  return slots.some((other) => other !== slot && !pool.bound.has(other.line.id) && fuzzyCandidates(other, pool)[0]?.entry.id === entry.id);
}

/** True when a line's two best free entries score about the same, so neither is clearly the one. */
function isAmbiguous(slot: Slot, slots: readonly Slot[], pool: Pool): boolean {
  const [best, ...rest] = fuzzyCandidates(slot, pool);
  const rival = rest.find((item) => !isPickOfOther(item.entry, slot, slots, pool));
  return !!best && !!rival && best.score - rival.score < AMBIGUOUS_GAP;
}

/**
 * The fuzzy pass: pairs bind best first, so a line prefers its best entry and does not lose it to an earlier line that
 * scores lower on it. A line whose two best free entries score about the same stays new, unless the other entry is the
 * clear pick of another line.
 */
function fuzzyPass(slots: readonly Slot[], pool: Pool): void {
  for (const { slot, entry } of fuzzyPairs(slots, pool)) {
    if (pool.bound.has(slot.line.id) || pool.claimed.has(entry.id) || isAmbiguous(slot, slots, pool)) continue;
    bind(pool, slot, entry);
  }
}

/**
 * Binds each line of a day to at most one entry of that day, and each entry to at most one line.
 * Passes: the stored scan key, the exact title, then a fuzzy title (best pair first, an ambiguous line binds nothing).
 * A line with an empty title binds nothing. Pure: it reads, it never writes. Lines with no entry are absent from the result.
 */
export function alignLines(lines: readonly Line[], existing: readonly ScanEntry[]): Map<string, ScanEntry> {
  const keys = new Map(existing.map((entry) => [entry.id, matchKey(entry.title)] as const));
  const pool: Pool = { entries: existing, keys, claimed: new Set(), bound: new Map() };
  const slots = lines.map((line, index) => ({ line, key: matchKey(line.title), index })).filter((slot) => slot.key !== "");
  exactPass(slots, pool, (entry) => entry.scan?.key ?? "");
  exactPass(slots, pool, (entry) => keys.get(entry.id)!);
  fuzzyPass(slots, pool);
  return pool.bound;
}
