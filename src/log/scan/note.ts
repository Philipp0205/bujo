import type { OcrLine } from "../../scan/ocr-client.ts";
import { TITLE_MAX } from "../validation.ts";
import { parseHeaderDate } from "./header.ts";

/** What a free-note scan suggests. Nothing is stored: the review edits it and the save goes through /api/entries. */
export type NoteSuggestion = {
  /** The first line without its heading marker, or "" when the page has no usable line. The screen words the fallback. */
  title: string;
  /** The day the note starts on: a clean header date of the page, else the day open in the log. */
  date: string;
  /** True when the date came from the page. */
  dateFromPage: boolean;
  /** The transcribed page as markdown. Empty when no line was read. */
  body: string;
};

const HEADING_MARKER = /^#{1,6}(?:\s+|$)/;

/** A title from one line of text: the leading markdown heading marker is stripped, spaces are tidied, the length is capped. */
export function noteTitle(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim().replace(HEADING_MARKER, "").trim();
  return flat.slice(0, TITLE_MAX).trim();
}

/** One OCR line as a markdown line. A bullet becomes a list item, an x a ticked one, a plain line stays plain. */
function toMarkdownLine(line: OcrLine): string {
  const text = line.text.trim();
  if (text === "") return "";
  if (line.symbol === "none") return text;
  return line.symbol === "x" ? `- [x] ${text}` : `- ${text}`;
}

/** Joins OCR lines into markdown, one line each. Lines with no text are left out. */
export function linesToMarkdown(lines: readonly OcrLine[]): string {
  return lines.map(toMarkdownLine).filter((text) => text !== "").join("\n");
}

/** The index of the first line with text, or -1. */
function firstTextIndex(lines: readonly OcrLine[]): number {
  return lines.findIndex((line) => line.text.trim() !== "");
}

/** The date of a page header when the first line with text is nothing but a date, with that line's index. */
function headerOf(lines: readonly OcrLine[], fallbackDate: string): { date: string; index: number } | null {
  const index = firstTextIndex(lines);
  if (index < 0 || lines[index].symbol !== "none") return null;
  const date = parseHeaderDate(lines[index].text, fallbackDate);
  return date ? { date, index } : null;
}

/** Builds the suggestion for a free-note page. A date header is the note's day and is not part of the text. Pure. */
export function suggestNote(lines: readonly OcrLine[], fallbackDate: string): NoteSuggestion {
  const header = headerOf(lines, fallbackDate);
  const content = lines.filter((_, index) => index !== header?.index);
  const first = content[firstTextIndex(content)];
  return {
    title: first ? noteTitle(first.text) : "",
    date: header?.date ?? fallbackDate,
    dateFromPage: header !== null,
    body: linesToMarkdown(content),
  };
}
