import { dateOf, monthOf } from "./date-token.ts";
import { TAG_MAX } from "./validation.ts";

/**
 * Written tags, dates and times in an entry line. The canonical parser: public/js/log/markup.js is its browser twin and
 * must behave the same (test/log-markup.test.ts runs both over one corpus).
 *
 * A token is a whitespace separated word.
 *   "#tag"            adds a tag. Every tag is kept, in the order written; a repeat that differs only in case is dropped.
 *   "@morgen", "@23.11." and the other date words of src/log/date-token.ts set the day (the last one wins).
 *   "@dez", "@december" and "@12.2026" set a whole month instead (the last day or month word wins).
 *   "9:00", "14:30", "14h" and "9h30" set the time as HH:MM (the last one wins).
 * All of them are cut out of the title. Anything glued to a word ("#tag,", "foo#bar", "14", "20.11.", "heute") is plain text.
 */

export type Markup = {
  /** The line without its tokens (trimmed when the parse is final). */
  title: string;
  /** The written tags in order, without repeats (compared ignoring case; the first spelling wins). */
  tags: string[];
  /** The last written day as YYYY-MM-DD, or null when none was found (or dates are off). */
  date: string | null;
  /** The last written month (a month word like "@dez", or "@12.2026") as YYYY-MM, or null. A later day word clears it, and the other way round. */
  month: string | null;
  /** The last written time as HH:MM, or null when none was found. */
  time: string | null;
};

export type MarkupOptions = {
  /**
   * False (the default) while the person is typing: a token at the very end of the text may still be growing
   * ("#ha" on the way to "#habit"), so only tokens followed by whitespace count. True for Enter, blur, save and
   * scanned text: the end of the text completes a token, and the title is trimmed.
   */
  final?: boolean;
  /** The day "@heute" and "@mo" count from, YYYY-MM-DD. Defaults to the local day. */
  today?: string;
  /** False leaves "@..." words in the title (scanned paper has no date field to put them in). Default true. */
  dates?: boolean;
};

const TAG_WORD = /^#([\p{L}\p{N}_-]+)$/u;
const HAS_LETTER = /\p{L}/u;
const CLOCK_TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;
/** "14h": two digits, so a duration like "5h" stays text. */
const HOUR_ONLY = /^([01]\d|2[0-3])[hH]$/;
/** "9h30" or "14h30". */
const HOUR_MINUTES = /^([01]?\d|2[0-3])[hH]([0-5]\d)$/;

type Piece = { gap: string; word: string; cut: boolean };

/** The tag a word writes, or null. At least one letter (so "#1" stays text) and within the tag length cap. */
function tagOf(word: string): string | null {
  const match = TAG_WORD.exec(word);
  if (!match || match[1].length > TAG_MAX || !HAS_LETTER.test(match[1])) return null;
  return match[1];
}

/** The time a word writes as HH:MM, or null. */
function timeOf(word: string): string | null {
  const match = CLOCK_TIME.exec(word) ?? HOUR_MINUTES.exec(word) ?? HOUR_ONLY.exec(word);
  if (!match) return null;
  return `${match[1].padStart(2, "0")}:${match[2] ?? "00"}`;
}

/** Today as YYYY-MM-DD on this machine's clock. */
function localToday(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Splits the text into words, each with the whitespace in front of it, and the whitespace after the last one. */
function pieces(text: string): { list: Piece[]; tail: string } {
  const list: Piece[] = [];
  let at = 0;
  for (const match of text.matchAll(/\S+/g)) {
    list.push({ gap: text.slice(at, match.index), word: match[0], cut: false });
    at = match.index + match[0].length;
  }
  return { list, tail: text.slice(at) };
}

/** Puts the kept words back together. The gap before a cut word goes with it, so no double space is left. */
function assemble(list: Piece[], tail: string): string {
  let out = "";
  let cutBefore = false;
  for (const piece of list) {
    if (piece.cut) {
      cutBefore = true;
      continue;
    }
    out += out === "" && cutBefore ? piece.word : piece.gap + piece.word;
  }
  return out === "" ? "" : out + tail;
}

/** Adds a tag unless the list has it already, ignoring case (the first spelling stays). */
function addTag(tags: string[], tag: string): void {
  const key = tag.toLowerCase();
  if (!tags.some((have) => have.toLowerCase() === key)) tags.push(tag);
}

/**
 * Reads the written tags, day and time of a line and returns the line without them.
 * A final parse that would leave no title at all (the line is only "#home") keeps the text as it is and finds nothing,
 * so a line is never emptied by its own markup.
 */
export function parseMarkup(text: string, options: MarkupOptions = {}): Markup {
  const final = options.final === true;
  const today = options.today ?? localToday();
  const { list, tail } = pieces(text);
  const found: Markup = { title: text, tags: [], date: null, month: null, time: null };
  list.forEach((piece, index) => {
    const growing = !final && index === list.length - 1 && tail === "";
    if (growing) return;
    const tag = tagOf(piece.word);
    const dated = tag === null && options.dates !== false;
    const day = dated ? dateOf(piece.word, today) : null;
    const month = dated && day === null ? monthOf(piece.word, today) : null;
    const clock = tag === null && day === null && month === null ? timeOf(piece.word) : null;
    if (tag === null && day === null && month === null && clock === null) return;
    piece.cut = true;
    if (tag !== null) addTag(found.tags, tag);
    else if (day !== null) Object.assign(found, { date: day, month: null });
    else if (month !== null) Object.assign(found, { date: null, month });
    else found.time = clock;
  });
  if (!list.some((piece) => piece.cut)) return { ...found, title: final ? text.trim() : text };
  const title = assemble(list, tail);
  if (final && title.trim() === "") return { title: text.trim(), tags: [], date: null, month: null, time: null };
  return { ...found, title: final ? title.trim() : title };
}
