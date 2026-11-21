import { matchKey } from "../../scan/match.ts";
import type { ScanEntry, ScanSnapshot } from "../types.ts";
import { alignLines } from "./align.ts";
import type { Fields, Line, Resolution } from "./types.ts";

const norm = (text: string | null | undefined): string => (text ?? "").trim().toLowerCase();

/** The fields of an entry as the scan compares them. */
function fieldsOf(entry: ScanEntry): Fields {
  return { type: entry.type, title: entry.title, tag: entry.tag, time: entry.time };
}

/** True when every field is the same (a title up to case, spacing, punctuation and umlaut spelling). */
function sameFields(a: Fields, b: Fields): boolean {
  return a.type === b.type && matchKey(a.title) === matchKey(b.title) && norm(a.tag) === norm(b.tag) && a.time === b.time;
}

/** True when the paper agrees with a base: a tag or time the paper does not write is not a difference. */
function agrees(paper: Fields, base: Fields): boolean {
  const tagOk = norm(paper.tag) === "" || norm(paper.tag) === norm(base.tag);
  const timeOk = !paper.time || paper.time === base.time;
  return paper.type === base.type && matchKey(paper.title) === matchKey(base.title) && tagOk && timeOk;
}

const snapshotFields = (snap: ScanSnapshot): Fields => ({ type: snap.type, title: snap.title, tag: snap.tag, time: snap.time });

/** The paper line as fields. An empty tag or time means the paper says none. */
function paperFields(line: Line): Fields {
  return { type: line.type, title: line.title.trim(), tag: norm(line.tag) === "" ? null : (line.tag ?? "").trim(), time: line.time || null };
}

/** The entry with the paper's changes laid over it: what apply would write. Fields the paper does not say stay. */
function proposal(paper: Fields, current: Fields): Fields {
  const sameTitle = matchKey(paper.title) === matchKey(current.title);
  return { type: paper.type, title: sameTitle ? current.title : paper.title, tag: paper.tag ?? current.tag, time: paper.time ?? current.time };
}

const NEW: Resolution = { status: "new", target: null, before: null, after: null, contested: false, protectedEdit: false };

/** True when the person changed the entry in the app after the last scan wrote it. */
function editedInApp(entry: ScanEntry, snap: ScanSnapshot | null | undefined): snap is ScanSnapshot {
  return !!snap && entry.updatedAt > snap.at && !sameFields(fieldsOf(entry), snapshotFields(snap));
}

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
