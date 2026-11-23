import { CORRECTIONS } from "./wordlist.ts";

/**
 * Matching scanned lines to open backlog titles and to the entries of a log page. German text, OCR noise tolerated.
 * normalise -> correct known misreadings -> drop a leading bullet -> fuzzy score.
 * The measure is the mean of a Levenshtein ratio (catches wrong letters) and a trigram Dice score (catches shifted or
 * dropped letters), 0..1. A shorter line that names most words of a longer title scores by word coverage, capped lower.
 * Two different numbers pull a score down, so "task 1" is not "task 2".
 * A weak or an ambiguous best match is not used by default: the review screen decides.
 * The log scan (src/log/scan) and the trace and rescan-key matching share this one matcher and this one threshold.
 */

/** Best score at or above this is a match: two texts are the same item. The one threshold for every matcher. */
export const MATCH_THRESHOLD = 0.7;
/** Two different tasks both over the threshold and closer than this make the match ambiguous. */
export const AMBIGUOUS_GAP = 0.1;
/** Candidates the review screen may offer. Lower than the threshold so a person can pick a weak one. */
export const CANDIDATE_FLOOR = 0.4;
export const MAX_CANDIDATES = 5;

export type Match = { list: string; uid: string; summary: string; score: number };

export type MatchResult = {
  /** The best candidate when it is strong and clear. Null when weak, ambiguous or nothing was close. */
  match: Match | null;
  /** Two close candidates over the threshold. */
  ambiguous: boolean;
  /** Best first, for the review screen to offer. */
  candidates: Match[];
};

export type Candidate = { list: string; uid: string; summary: string };

const UMLAUTS: Record<string, string> = { "ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss" };

/** Lowercase, umlauts as ae oe ue ss, accents dropped, punctuation to spaces, spaces collapsed. */
export function normalise(text: string): string {
  const lower = text.normalize("NFC").toLowerCase().replace(/[äöüß]/g, (ch) => UMLAUTS[ch]);
  // NFD splits é into e and a combining mark. Only the marks go. The umlauts were handled above.
  const plain = lower.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return plain.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/**
 * Replaces known misreadings (src/scan/wordlist.ts), word by word. A capital first letter stays a capital.
 * Anything around the word, such as a trailing colon, is kept.
 */
export function correctWords(text: string): string {
  return text.replace(/[\p{L}\p{N}]+/gu, (word) => {
    const fix = CORRECTIONS[normalise(word)];
    if (!fix) return word;
    const first = word[0];
    return first === first.toUpperCase() && first !== first.toLowerCase() ? fix[0].toUpperCase() + fix.slice(1) : fix;
  });
}

/**
 * The form that is compared: corrected, then normalised, with a leading "x" bullet word dropped. The other bullets
 * (• – ○ > <) are punctuation, so normalise already removes them. A lone "x" is kept: it is all the title there is.
 */
export function matchKey(text: string): string {
  return normalise(correctWords(text)).replace(/^x (?=\S)/, "");
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

/** 1 for equal strings, 0 for nothing in common. */
export function levenshteinSimilarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  return longest === 0 ? 1 : 1 - levenshtein(a, b) / longest;
}

function trigrams(text: string): Map<string, number> {
  const padded = `  ${text} `;
  const grams = new Map<string, number>();
  for (let i = 0; i + 3 <= padded.length; i++) {
    const gram = padded.slice(i, i + 3);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  return grams;
}

/** Dice coefficient over padded trigrams. */
export function trigramSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const ga = trigrams(a);
  const gb = trigrams(b);
  let shared = 0;
  let total = 0;
  for (const count of ga.values()) total += count;
  for (const count of gb.values()) total += count;
  for (const [gram, count] of ga) shared += Math.min(count, gb.get(gram) ?? 0);
  return total === 0 ? 0 : (2 * shared) / total;
}

const WORD_FUZZ = 0.75;

/** How much of the scanned line's text (by letters) is found, fuzzily, as words of the title. */
function wordCoverage(scan: string[], title: string[]): number {
  const total = scan.reduce((sum, word) => sum + word.length, 0);
  if (total === 0) return 0;
  let covered = 0;
  for (const word of scan) {
    let best = 0;
    for (const other of title) best = Math.max(best, levenshteinSimilarity(word, other));
    if (best >= WORD_FUZZ) covered += word.length * best;
  }
  return covered / total;
}

const isNumber = (word: string) => /^\d+$/.test(word);

/** True when both texts name numbers and the numbers differ: "task 1" and "task 2" are different tasks. */
function numbersDiffer(wa: string[], wb: string[]): boolean {
  const na = wa.filter(isNumber);
  const nb = wb.filter(isNumber);
  return na.length > 0 && nb.length > 0 && na.join(" ") !== nb.join(" ");
}

/** Mean of the Levenshtein ratio and the trigram Dice score of two normalised strings: the whole-text measure. */
function wholeSimilarity(a: string, b: string): number {
  return 0.5 * levenshteinSimilarity(a, b) + 0.5 * trigramSimilarity(a, b);
}

/** Similarity of two already-normalised strings, 0..1. */
export function similarity(a: string, b: string): number {
  if (a === "" || b === "") return 0;
  if (a === b) return 1;
  const whole = wholeSimilarity(a, b);
  const wa = a.split(" ");
  const wb = b.split(" ");
  // A shorter line that names several words of a longer title. One word alone is not enough, and the line has to
  // carry a fair share of the title's letters. Capped below a full match.
  const letters = (words: string[]) => words.reduce((sum, word) => sum + word.length, 0);
  const partial = wa.length >= 2 && letters(wa) >= 0.35 * letters(wb) ? 0.85 * wordCoverage(wa, wb) : 0;
  const score = Math.max(whole, partial);
  return numbersDiffer(wa, wb) ? score * 0.6 : score;
}

/** Letter-level score (spaces ignored) from which a matched title reads as the same words misread, not as a reworded title. */
export const SAME_WORDS = 0.8;

/**
 * True when two titles say the same thing up to OCR noise: equal keys, or the same letters give or take a few wrong,
 * dropped or split ones (Levenshtein ratio with spaces ignored, SAME_WORDS or more) and no differing number. A matched
 * line with such a title restates its entry, so the entry keeps its own spelling. An added or removed word is a real edit.
 */
export function sameWords(a: string, b: string): boolean {
  const ka = matchKey(a);
  const kb = matchKey(b);
  if (ka === kb) return true;
  if (ka === "" || kb === "") return false;
  return !numbersDiffer(ka.split(" "), kb.split(" ")) && levenshteinSimilarity(ka.replace(/ /g, ""), kb.replace(/ /g, "")) >= SAME_WORDS;
}

/** Scores a line against every open task and decides. `candidates` are the open tasks to match against. */
export function matchLine(text: string, candidates: readonly Candidate[]): MatchResult {
  const key = matchKey(text);
  if (key === "") return { match: null, ambiguous: false, candidates: [] };
  const scored: Match[] = candidates
    .map((task) => ({ list: task.list, uid: task.uid, summary: task.summary, score: similarity(key, matchKey(task.summary)) }))
    .filter((item) => item.score >= CANDIDATE_FLOOR)
    .map((item) => ({ ...item, score: Math.round(item.score * 1000) / 1000 }))
    .sort((a, b) => b.score - a.score || a.summary.localeCompare(b.summary, "de"))
    .slice(0, MAX_CANDIDATES);
  const [best, second] = scored;
  if (!best || best.score < MATCH_THRESHOLD) return { match: null, ambiguous: false, candidates: scored };
  const ambiguous = !!second && second.score >= MATCH_THRESHOLD && best.score - second.score < AMBIGUOUS_GAP;
  return { match: ambiguous ? null : best, ambiguous, candidates: scored };
}
