import { HttpError } from "../../app-kit/http.ts";
import { isEntryType, isValidDate } from "../validation.ts";
import type { EntryType } from "../types.ts";
import type { LogDraft } from "./draft.ts";

/** The most lines one request may carry. A page holds far fewer. */
const MAX_ITEMS = 200;
const ITEM_KEYS = ["id", "type", "title", "tag", "include"];

/** One line as the review sends it back: edits included. */
export type SentItem = { id: string; type: EntryType; title: string; tag: unknown; include: boolean };
export type SentReview = { date: string; items: SentItem[] };

function bad(message: string): never {
  throw new HttpError(400, message);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** One sent line: a known id, a real type, text for the title. The title and tag are checked again on apply. */
function parseItem(raw: unknown, index: number, draft: LogDraft): SentItem {
  const at = `items[${index}]`;
  if (!isObject(raw)) bad(`${at} must be an object`);
  const unknown = Object.keys(raw).find((key) => !ITEM_KEYS.includes(key));
  if (unknown) bad(`${at}: unknown field ${unknown.slice(0, 40)}`);
  if (typeof raw.id !== "string" || !draft.lines.some((line) => line.id === raw.id)) bad(`${at}: unknown item id`);
  if (!isEntryType(raw.type)) bad(`${at}: type must be task, note, event, done, migrated or scheduled`);
  if (typeof raw.title !== "string") bad(`${at}: title must be text`);
  if (raw.include !== undefined && typeof raw.include !== "boolean") bad(`${at}: include must be true or false`);
  return { id: raw.id, type: raw.type, title: raw.title, tag: raw.tag ?? null, include: raw.include !== false };
}

/**
 * Checks a request body of the shape { date, items: [{ id, type, title, tag?, include? }] }.
 * Used by both the check and the apply step, so they read the same thing. 400 on anything else.
 */
export function parseReview(body: Record<string, unknown>, draft: LogDraft): SentReview {
  for (const key of Object.keys(body)) if (key !== "date" && key !== "items") bad(`unknown field: ${key.slice(0, 40)}`);
  if (!isValidDate(body.date)) bad("date must be a date like 2026-11-20");
  if (!Array.isArray(body.items)) bad("items must be an array");
  if (body.items.length > MAX_ITEMS) bad("too many items");
  const seen = new Set<string>();
  const items = body.items.map((raw, index) => {
    const item = parseItem(raw, index, draft);
    if (seen.has(item.id)) bad(`items[${index}]: ${item.id} was sent twice`);
    seen.add(item.id);
    return item;
  });
  return { date: body.date, items };
}
