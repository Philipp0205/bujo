import { matchKey } from "../../scan/match.ts";
import type { ScanEntry } from "../types.ts";
import { alignLines } from "./align.ts";
import { editedInApp, fieldsOf, norm, snapshotFields, tagKeys } from "./fields.ts";
import type { Fields, Line, Resolution } from "./types.ts";

/** True when the paper agrees with a base: tags or a time the paper does not write are not a difference. */
function agrees(paper: Fields, base: Fields): boolean {
  const tagOk = paper.tags.length === 0 || tagKeys(paper.tags) === tagKeys(base.tags);
  const timeOk = !paper.time || paper.time === base.time;
  return paper.type === base.type && matchKey(paper.title) === matchKey(base.title) && tagOk && timeOk;
}

/** The paper line as fields. No tags or an empty time means the paper says none. */
function paperFields(line: Line): Fields {
  const tags = (line.tags ?? []).map((tag) => tag.trim()).filter((tag) => tag !== "");
  return { type: line.type, title: line.title.trim(), tags, time: line.time || null };
}

/** The paper's tags with the entry's own spelling kept for a tag that differs only in case. */
function keepSpelling(paper: readonly string[], current: readonly string[]): string[] {
  return paper.map((tag) => current.find((have) => norm(have) === norm(tag)) ?? tag);
}

/** The entry with the paper's changes laid over it: what apply would write. Fields the paper does not say stay. */
function proposal(paper: Fields, current: Fields): Fields {
  const sameTitle = matchKey(paper.title) === matchKey(current.title);
  const tags = paper.tags.length > 0 ? keepSpelling(paper.tags, current.tags) : current.tags;
  return { type: paper.type, title: sameTitle ? current.title : paper.title, tags, time: paper.time ?? current.time };
}

export const NEW: Resolution = { status: "new", target: null, before: null, after: null, contested: false, protectedEdit: false };

/** What a line bound to an entry means: unchanged, an app edit to leave alone, or an edit to propose. */
function classify(line: Line, entry: ScanEntry): Resolution {
  const paper = paperFields(line);
  const current = fieldsOf(entry);
  const unchanged: Resolution = { status: "unchanged", target: entry, before: null, after: null, contested: false, protectedEdit: false };
  if (agrees(paper, current)) return unchanged;
  const snap = entry.scan;
  const appEdited = editedInApp(entry, snap);
  const paperMoved = !snap || !agrees(paper, snapshotFields(snap));
  if (appEdited && !paperMoved) return { ...unchanged, protectedEdit: true };
  return { status: "edited", target: entry, before: current, after: proposal(paper, current), contested: appEdited && paperMoved, protectedEdit: false };
}

/**
 * Decides every line against the entries already on its day, in page order. Pure: it reads, it never writes.
 * One matcher serves the first scan of a day and every rescan. An entry no line matches is left out of the result.
 */
export function resolveLines(lines: readonly Line[], existing: readonly ScanEntry[]): Map<string, Resolution> {
  const bound = alignLines(lines, existing);
  const out = new Map<string, Resolution>();
  for (const line of lines) {
    const entry = bound.get(line.id);
    out.set(line.id, entry ? classify(line, entry) : NEW);
  }
  return out;
}
