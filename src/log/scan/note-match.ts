import { AMBIGUOUS_GAP, MATCH_THRESHOLD, matchKey, similarity } from "../../scan/match.ts";
import type { NoteSuggestion } from "./note.ts";

/** The saved note a scan most likely is. Only what the review needs to offer the update. */
export type NoteMatch = { id: string; title: string; date: string; body: string };

type SavedNote = { id: string; title: string; date: string; body: string | null };

/** Letters of a body that are compared. A long note is judged by its start, which keeps the distance measure cheap. */
const BODY_KEY_MAX = 1500;

/** The comparable form of a body: corrected, normalised, capped. */
function bodyKey(body: string | null): string {
  return matchKey(body ?? "").slice(0, BODY_KEY_MAX);
}

/** How alike a scan and a saved note are, 0..1: the better of the titles and the bodies. An empty title counts for nothing, so the body decides. */
function noteScore(scan: { title: string; body: string }, note: SavedNote): number {
  const titles = similarity(matchKey(scan.title), matchKey(note.title));
  return Math.max(titles, similarity(bodyKey(scan.body), bodyKey(note.body)));
}

/**
 * Finds the one saved note a scan most likely is, with the page matcher's threshold and its ambiguity rule: the best score must
 * reach MATCH_THRESHOLD and no other note may be within AMBIGUOUS_GAP of it. Otherwise null. Pure: `notes` are the person's own notes.
 */
export function matchNote(scan: NoteSuggestion, notes: readonly SavedNote[]): NoteMatch | null {
  const scored = notes
    .map((note) => ({ note, score: noteScore(scan, note) }))
    .filter((item) => item.score >= MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score || a.note.id.localeCompare(b.note.id));
  const [best, second] = scored;
  if (!best || (second && best.score - second.score < AMBIGUOUS_GAP)) return null;
  const { id, title, date, body } = best.note;
  return { id, title, date, body: body ?? "" };
}
