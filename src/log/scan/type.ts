import type { OcrLine } from "../../scan/ocr-client.ts";
import { showsLogStructure } from "./kind.ts";

/** What a page is saved as: log lines, or a note (a free-form page or a custom collection). */
export type PageType = "log" | "note";

/** Why a type was guessed: log structure on the page (date or month heading), a title line that is not a date, bullet lines, or plain text with no bullets. */
export type TypeSource = "structure" | "title" | "bullets" | "plain";

export type TypeGuess = { type: PageType; source: TypeSource };

type PageLine = Pick<OcrLine, "symbol" | "text">;

/**
 * Guesses whether a page is a log or a note. The LLM kind is ignored on purpose: it must always name one of the four log kinds,
 * so it says nothing about a free-form page. A date or month heading, or climbing day rows, make a log. Without them a first
 * line with no bullet is a title (a collection or free note), and a page of bullets is a log. A page with no bullet at all is a note.
 * The review shows the guess and lets the person change it.
 */
export function guessType(lines: readonly PageLine[], fallbackDate: string): TypeGuess {
  if (showsLogStructure(lines, fallbackDate)) return { type: "log", source: "structure" };
  const texts = lines.filter((line) => line.text.trim() !== "");
  if (texts.length > 0 && texts[0].symbol === "none") return { type: "note", source: "title" };
  if (texts.some((line) => line.symbol !== "none")) return { type: "log", source: "bullets" };
  return { type: "note", source: "plain" };
}
