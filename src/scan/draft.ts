import { randomBytes } from "node:crypto";
import { isCalendarDate } from "../app-kit/time.ts";
import type { OcrLine, OcrResult, OcrSymbol } from "./ocr-client.ts";
import { correctWords, matchLine, type Match } from "./match.ts";

/**
 * A draft is the reviewable result of one scan: one item per OCR line, each with a proposed action.
 * It is built here from the OCR answer and the open backlog, kept in memory (store.ts), and never holds the photo.
 * Nothing in a draft is written anywhere until Philipp accepts items (apply.ts).
 */

export const TIME_ZONE = "Europe/Berlin";

export type Action = "complete" | "create" | "keep" | "schedule" | "ignore";

export type DraftItem = {
  id: string;
  /** What the detector saw. The picker in the review may change `symbol`, never this. */
  detected: OcrSymbol;
  symbol: OcrSymbol;
  confidence: number;
  engine: string;
  bbox: [number, number, number, number];
  /** The text as OCR read it. */
  ocrText: string;
  /** The proposed text: OCR text with known misreadings corrected. Editable in the review. */
  text: string;
  action: Action;
  /** The target list for a new task. An existing task is always written in its own list. */
  list: string;
  /** The open task this line is treated as. Null: none, weak, or ambiguous. */
  match: Match | null;
  /** A strong, clear match even when the symbol does not use one (a note that names a task). */
  suggested: Match | null;
  /** Close candidates for the review, best first. */
  candidates: Match[];
  ambiguous: boolean;
  /** YYYY-MM-DD. Set by the person in the review for a scheduled line. */
  due: string | null;
  include: boolean;
  /** Why the proposal is what it is. Shown in the review. */
  note: string | null;
  /** True for the line the page date was read from. */
  isDate: boolean;
};

export type ApplyResult = {
  id: string;
  ok: boolean;
  /** "written" (a CalDAV write happened), "kept" (nothing to write), "failed", or "skipped" (not tried). */
  status: "written" | "kept" | "failed" | "skipped";
  action?: Action;
  task?: unknown;
  error?: string;
};

export type Draft = {
  id: string;
  created: number;
  expires: number;
  /** YYYY-MM-DD. The date on the page when a date line was read, else the scan day. Not written to tasks. */
  pageDate: string;
  pageDateSource: "line" | "scan";
  /** The day the photo was scanned, in Europe/Berlin. */
  scanDay: string;
  lists: string[];
  defaultList: string;
  image: { width: number; height: number };
  ocrMs: number;
  items: DraftItem[];
  applied: boolean;
  results: ApplyResult[] | null;
};

/** The action a symbol means, given whether the line is tied to an existing open task. */
export function actionFor(symbol: OcrSymbol, hasMatch: boolean): Action {
  switch (symbol) {
    case "x":
      return "complete";
    case "•":
    case ">":
      return hasMatch ? "keep" : "create";
    case "<":
      return "schedule";
    default:
      return "ignore";
  }
}

const OCR_DIGITS: Record<string, string> = { O: "0", o: "0", Q: "0", I: "1", l: "1", "|": "1", S: "5", B: "8" };

/**
 * A day from a date line: dd.mm.yyyy or dd.mm.yy, with OCR noise tolerated (O for 0, l for 1, commas,
 * dashes or spaces for dots). Returns YYYY-MM-DD, or null when the text is no real date.
 */
export function parseDateLine(text: string): string | null {
  const cleaned = text
    .trim()
    .replace(/[OoQIl|SB]/g, (ch) => OCR_DIGITS[ch] ?? ch);
  // Try every start position: a stray digit before the date ("Do" read as "D0") must not hide it.
  const pattern = /(?<!\d)(\d{1,2})\s*[.,:;/\-\s]\s*(\d{1,2})\s*[.,:;/\-\s]\s*(\d{4}|\d{2})(?!\d)/y;
  for (let start = 0; start < cleaned.length; start++) {
    pattern.lastIndex = start;
    const match = pattern.exec(cleaned);
    if (!match) continue;
    const day = match[1].padStart(2, "0");
    const month = match[2].padStart(2, "0");
    const year = match[3].length === 2 ? `20${match[3]}` : match[3];
    const iso = `${year}-${month}-${day}`;
    if (isCalendarDate(iso)) return iso;
  }
  return null;
}

export type OpenTask = { list: string; uid: string; summary: string };

export type BuildInput = {
  ocr: OcrResult;
  open: readonly OpenTask[];
  lists: string[];
  defaultList: string;
  /** The scan day, YYYY-MM-DD in Europe/Berlin. */
  scanDay: string;
  now: number;
  ttlMs: number;
  id?: string;
};

function buildItem(line: OcrLine, index: number, input: BuildInput): DraftItem {
  const text = correctWords(line.text.trim());
  const found = matchLine(text, input.open);
  const usesMatch = line.symbol === "x" || line.symbol === "•" || line.symbol === ">" || line.symbol === "<";
  const match = usesMatch ? found.match : null;
  const action = actionFor(line.symbol, match !== null);
  let include = action !== "ignore";
  let note: string | null = null;

  if (text === "" && action !== "ignore") {
    include = false;
    note = "No text was read for this line.";
  } else if (action === "complete" && !match) {
    include = false;
    note = found.ambiguous ? "Two open tasks fit. Pick one to mark it done." : "No matching open task found.";
  } else if (action === "schedule") {
    note = match
      ? "Sets the due date of the matching task. Pick a date."
      : found.ambiguous
        ? "Two open tasks fit. Pick one, or this creates a new task. Pick a date."
        : "Creates a task with this due date. Pick a date.";
  } else if (action === "keep") {
    note = "Already in the backlog. Nothing is written.";
  } else if (action === "create" && found.ambiguous) {
    note = "Two open tasks fit. Pick one, or this creates a new task.";
  } else if (action === "ignore") {
    note = line.symbol === "none" ? "No bullet. Not a task." : line.symbol === "○" ? "Event. Not synced." : "Note. Not synced.";
  }

  return {
    id: `l${index + 1}`,
    detected: line.symbol,
    symbol: line.symbol,
    confidence: line.confidence,
    engine: line.engine,
    bbox: line.bbox,
    ocrText: line.text,
    text,
    action,
    list: input.defaultList,
    match,
    suggested: found.match,
    candidates: found.candidates,
    ambiguous: found.ambiguous,
    due: null,
    include,
    note,
    isDate: false,
  };
}

export function buildDraft(input: BuildInput): Draft {
  const items = input.ocr.lines.map((line, index) => buildItem(line, index, input));

  // The first "none" line that parses as a date is the page date. Its line is not a task.
  let pageDate = input.scanDay;
  let pageDateSource: Draft["pageDateSource"] = "scan";
  for (const item of items) {
    if (item.detected !== "none") continue;
    const parsed = parseDateLine(item.ocrText);
    if (!parsed) continue;
    pageDate = parsed;
    pageDateSource = "line";
    item.isDate = true;
    item.include = false;
    item.note = "Page date.";
    break;
  }

  return {
    id: input.id ?? randomBytes(16).toString("base64url"),
    created: input.now,
    expires: input.now + input.ttlMs,
    pageDate,
    pageDateSource,
    scanDay: input.scanDay,
    lists: input.lists,
    defaultList: input.defaultList,
    image: { width: input.ocr.width, height: input.ocr.height },
    ocrMs: input.ocr.ms,
    items,
    applied: false,
    results: null,
  };
}
