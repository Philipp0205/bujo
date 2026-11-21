import { TAG_MAX } from "./validation.ts";

/**
 * Written tags and times in an entry line. The canonical parser: public/js/log/markup.js is its browser twin and must
 * behave the same (test/log-markup.test.ts runs both over one corpus).
 *
 * A token is a whitespace separated word. "#tag" sets the tag (the last one wins), "9:00", "14:30", "14h" and "9h30"
 * set the time as HH:MM (the last one wins). Both are cut out of the title. Anything glued to a word ("#tag,",
 * "foo#bar", "14", "20.11.") is plain text.
 */

export type Markup = {
  /** The line without its tokens (trimmed when the parse is final). */
  title: string;
  /** The last written tag, or null when none was found. */
  tag: string | null;
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

/**
 * Reads the written tag and time of a line and returns the line without them.
 * A final parse that would leave no title at all (the line is only "#home") keeps the text as it is and finds nothing,
 * so a line is never emptied by its own markup.
 */
export function parseMarkup(text: string, options: MarkupOptions = {}): Markup {
  const final = options.final === true;
  const { list, tail } = pieces(text);
  let tag: string | null = null;
  let time: string | null = null;
  list.forEach((piece, index) => {
    const growing = !final && index === list.length - 1 && tail === "";
    if (growing) return;
    const written = tagOf(piece.word);
    const clock = written === null ? timeOf(piece.word) : null;
    if (written === null && clock === null) return;
    piece.cut = true;
    if (written !== null) tag = written;
    else time = clock;
  });
  if (tag === null && time === null) return { title: final ? text.trim() : text, tag, time };
  const title = assemble(list, tail);
  if (final && title.trim() === "") return { title: text.trim(), tag: null, time: null };
  return { title: final ? title.trim() : title, tag, time };
}
