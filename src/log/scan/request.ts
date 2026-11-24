import { HttpError } from "../../app-kit/http.ts";
import { isEntryType, isValidDate } from "../validation.ts";
import type { EntryType } from "../types.ts";
import type { LogDraft } from "./draft.ts";
import { isMonth, slotOf, type Placed } from "./plan.ts";
import { isPageKind, type Line, type PageKind } from "./types.ts";

/** The most lines one request may carry. A page holds far fewer. */
const MAX_ITEMS = 200;
const ITEM_KEYS = ["id", "type", "title", "tags", "time", "include", "day", "month", "unmatched", "important"];
const BODY_KEYS = ["kind", "date", "month", "page", "items"];

/** One line as the review sends it back: edits included. `day` is a calendar line's day, `month` a future line's month (YYYY-MM). `unmatched` says it is not the entry it matched. */
export type SentItem = {
  id: string;
  type: EntryType;
  title: string;
  tags: unknown;
  time: unknown;
  include: boolean;
  day: number | null;
  month: string | null;
  unmatched: boolean;
  /** The handwritten * on the line, or turned on in the review. */
  important: boolean;
  /** The review explicitly turned the marker off (important: false). A line that only lacks a * on paper leaves this false. */
  unflag: boolean;
};

/** What the review sends: the page kind, the day of a daily page or the month of a calendar or month-task page, the physical page and the lines. */
export type SentReview = { kind: PageKind; date: string | null; month: string | null; page: number; items: SentItem[] };

/** The most physical pages one day may have. A real log never comes near it. */
export const MAX_PAPER_PAGE = 20;

/** A sent line as the matcher reads it: tags that are not a list of text, or a time that is not text, count as none. The apply step checks them for real. */
export function toLine(item: SentItem, kind: PageKind = "daily"): Line {
  return {
    id: item.id,
    type: kind !== "daily" && kind !== "calendar" && item.type === "event" ? "task" : item.type,
    title: item.title,
    tags: Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === "string") : [],
    time: typeof item.time === "string" ? item.time : null,
    unmatched: item.unmatched,
  };
}

/** The sent lines with the slot each files in. A line whose slot cannot be told (no real day or month) has a null slot. */
export function placeReview(review: SentReview, fallbackDate: string): Placed[] {
  const where = { kind: review.kind, date: review.date ?? fallbackDate, month: review.month };
  return review.items.map((item) => ({ line: toLine(item, review.kind), slot: slotOf(where, item) }));
}

function bad(message: string): never {
  throw new HttpError(400, message);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** A calendar day: a whole number 1 to 31, or missing (null). */
function parseDay(value: unknown, at: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 31) bad(`${at}: day must be a whole number from 1 to 31`);
  return value;
}

/** A future line's month as YYYY-MM, or missing (null). */
function parseLineMonth(value: unknown, at: string): string | null {
  if (value === undefined || value === null) return null;
  if (!isMonth(value)) bad(`${at}: month must be a month like 2026-12`);
  return value;
}

/** One sent line: a known id, a real type, text for the title. The title and tags are checked again on apply. */
function parseItem(raw: unknown, index: number, draft: LogDraft): SentItem {
  const at = `items[${index}]`;
  if (!isObject(raw)) bad(`${at} must be an object`);
  const unknown = Object.keys(raw).find((key) => !ITEM_KEYS.includes(key));
  if (unknown) bad(`${at}: unknown field ${unknown.slice(0, 40)}`);
  if (typeof raw.id !== "string" || !/^l[1-9]\d*$/.test(raw.id) || Number(raw.id.slice(1)) > draft.page.length) bad(`${at}: unknown item id`);
  if (!isEntryType(raw.type)) bad(`${at}: type must be task, note, event, done, migrated, scheduled or dropped`);
  if (typeof raw.title !== "string") bad(`${at}: title must be text`);
  if (raw.include !== undefined && typeof raw.include !== "boolean") bad(`${at}: include must be true or false`);
  if (raw.unmatched !== undefined && typeof raw.unmatched !== "boolean") bad(`${at}: unmatched must be true or false`);
  const { id, type, title } = raw as { id: string; type: EntryType; title: string };
  if (raw.important !== undefined && typeof raw.important !== "boolean") bad(`${at}: important must be true or false`);
  return { id, type, title, tags: raw.tags ?? [], time: raw.time ?? null, include: raw.include !== false, day: parseDay(raw.day, at), month: parseLineMonth(raw.month, at), unmatched: raw.unmatched === true, important: raw.important === true, unflag: raw.important === false };
}

/** The kind a request names, or the draft's detected kind when it names none. */
function parseKind(value: unknown, draft: LogDraft): PageKind {
  if (value === undefined) return draft.detected.kind;
  if (!isPageKind(value)) bad("kind must be daily, future, calendar or month-task");
  return value;
}

/** The day of a daily page (required) or an optional day of any other kind. */
function parseDate(value: unknown, kind: PageKind): string | null {
  if (value === undefined && kind !== "daily") return null;
  if (!isValidDate(value)) bad("date must be a date like 2026-11-20");
  return value;
}

/** The month of a calendar or month-task page (required), or none for the other kinds. */
function parseMonth(value: unknown, kind: PageKind): string | null {
  const needed = kind === "calendar" || kind === "month-task";
  if (value === undefined || value === null) return needed ? bad("month must be a month like 2026-12") : null;
  if (!isMonth(value)) bad("month must be a month like 2026-12");
  return needed ? value : null;
}

/** The physical page the photo shows: a whole number 1 to MAX_PAPER_PAGE. Left out means page 1, so a request without one rescans the first page as before. */
function parsePaperPage(value: unknown): number {
  if (value === undefined) return 1;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > MAX_PAPER_PAGE) bad(`page must be a whole number from 1 to ${MAX_PAPER_PAGE}`);
  return value;
}

/**
 * Checks a request body of the shape { kind?, date?, month?, page?, items: [{ id, type, title, tags?, time?, include?, day?, month?, unmatched? }] }.
 * Used by both the check and the apply step, so they read the same thing. 400 on anything else.
 * A daily page needs `date`. A calendar or month-task page needs `month`. A future page needs neither, each line carries its month.
 * The apply step may send every line of the review: skipped lines (include false) let it record the key of an unchanged one.
 */
export function parseReview(body: Record<string, unknown>, draft: LogDraft): SentReview {
  for (const key of Object.keys(body)) if (!BODY_KEYS.includes(key)) bad(`unknown field: ${key.slice(0, 40)}`);
  const kind = parseKind(body.kind, draft);
  const date = parseDate(body.date, kind);
  const month = parseMonth(body.month, kind);
  if (!Array.isArray(body.items)) bad("items must be an array");
  if (body.items.length > MAX_ITEMS) bad("too many items");
  const seen = new Set<string>();
  const items = body.items.map((raw, index) => {
    const item = parseItem(raw, index, draft);
    if (seen.has(item.id)) bad(`items[${index}]: ${item.id} was sent twice`);
    seen.add(item.id);
    return item;
  });
  return { kind, date, month, page: parsePaperPage(body.page), items };
}
