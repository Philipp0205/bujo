import { matchKey, matchLine } from "../../scan/match.ts";
import type { Entry, EntryType } from "../types.ts";

/**
 * What a scanned line means for the log of its day:
 *   new        a fresh entry
 *   duplicate  the day already has an entry with this title
 *   completes  an x line that names an open task of the day: that task is marked done, no new entry
 */
export type ScanStatus = "new" | "duplicate" | "completes";

export type Line = { id: string; type: EntryType; title: string };
export type Resolution = { status: ScanStatus; target: Entry | null };

/** True when two titles are the same up to case, spacing, punctuation and umlaut spelling. */
function sameTitle(a: string, b: string): boolean {
  const key = matchKey(a);
  return key !== "" && key === matchKey(b);
}

/** The open task of the day an x line names (fuzzy, reusing the backlog matcher), or null. Claimed tasks are skipped. */
function findOpenTask(title: string, existing: readonly Entry[], claimed: ReadonlySet<string>): Entry | null {
  const open = existing.filter((entry) => entry.type === "task" && !claimed.has(entry.id));
  const found = matchLine(title, open.map((entry) => ({ list: "", uid: entry.id, summary: entry.title })));
  return open.find((entry) => entry.id === found.match?.uid) ?? null;
}

/**
 * Decides every line against the entries already on its day, in page order. Pure: it reads, it never writes.
 * One task is completed by one line at most.
 */
export function resolveLines(lines: readonly Line[], existing: readonly Entry[]): Map<string, Resolution> {
  const claimed = new Set<string>();
  const out = new Map<string, Resolution>();
  for (const line of lines) {
    const task = line.type === "done" ? findOpenTask(line.title, existing, claimed) : null;
    if (task) {
      claimed.add(task.id);
      out.set(line.id, { status: "completes", target: task });
    } else if (existing.some((entry) => sameTitle(entry.title, line.title))) {
      out.set(line.id, { status: "duplicate", target: null });
    } else {
      out.set(line.id, { status: "new", target: null });
    }
  }
  return out;
}
