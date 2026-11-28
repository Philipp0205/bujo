import { normalise } from "../../scan/match.ts";
import type { OcrLine } from "../../scan/ocr-client.ts";
import type { EntrySection } from "../types.ts";

/** The words that head a section of a month's task page, after normalise() (lowercase, punctuation gone): English and German. */
const SECTION_WORDS: Record<string, EntrySection> = {
  work: "work",
  arbeit: "work",
  private: "private",
  privat: "private",
  personal: "private",
};

/** The section a heading text names ("Work", "Privat:", "PERSONAL"), or null for any other text. */
export function parseSection(text: string): EntrySection | null {
  return SECTION_WORDS[normalise(text)] ?? null;
}

/** Every section heading line of a page, by line index. Only a line with no bullet can be one. */
export function findSections(lines: ReadonlyArray<Pick<OcrLine, "symbol" | "text">>): Map<number, EntrySection> {
  const found = new Map<number, EntrySection>();
  lines.forEach((line, index) => {
    const section = line.symbol === "none" ? parseSection(line.text) : null;
    if (section) found.set(index, section);
  });
  return found;
}

/** The section a line falls under: that of the nearest section heading above it, else null. */
export function sectionOf(index: number, sections: ReadonlyMap<number, EntrySection>): EntrySection | null {
  let found: EntrySection | null = null;
  for (const [at, section] of sections) if (at < index) found = section;
  return found;
}
