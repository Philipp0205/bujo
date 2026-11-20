import {
  ENTRY_TYPES,
  type Checked,
  type DateRange,
  type EntryPatch,
  type EntryType,
  type NewEntry,
} from "./types.ts";

export const TITLE_MAX = 200;
export const TAG_MAX = 40;
/** The widest list request, in days from the first to the last day, inclusive. */
export const RANGE_MAX_DAYS = 92;

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_SHAPE = /^([01]\d|2[0-3]):[0-5]\d$/;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const DAY_MS = 86_400_000;

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** True for a real calendar day written YYYY-MM-DD. */
export function isValidDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_SHAPE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

/** True for HH:MM on a 24 hour clock. */
export function isValidTime(value: unknown): value is string {
  return typeof value === "string" && TIME_SHAPE.test(value);
}

export function isEntryType(value: unknown): value is EntryType {
  return typeof value === "string" && (ENTRY_TYPES as readonly string[]).includes(value);
}

/** Whole days from one valid date to another. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** Checks the from and to of a list request: both real dates, in order, and not wider than the cap. */
export function checkRange(from: unknown, to: unknown): Checked<DateRange> {
  if (!isValidDate(from)) return fail("from must be a date like 2026-11-20");
  if (!isValidDate(to)) return fail("to must be a date like 2026-11-20");
  if (from > to) return fail("from must not be after to");
  if (daysBetween(from, to) + 1 > RANGE_MAX_DAYS) return fail(`the range is too long (at most ${RANGE_MAX_DAYS} days)`);
  return { ok: true, value: { from, to } };
}

/** A one-line text field, trimmed. Empty is allowed only when `required` is false (it then means "none"). */
function checkText(key: string, value: unknown, max: number, required: boolean): Checked<string | null> {
  if (value === null && !required) return { ok: true, value: null };
  if (typeof value !== "string") return fail(`${key} must be text`);
  const trimmed = value.trim();
  if (trimmed === "") return required ? fail(`${key} is required`) : { ok: true, value: null };
  if (trimmed.length > max) return fail(`${key} is too long (at most ${max} characters)`);
  if (CONTROL_CHARS.test(trimmed)) return fail(`${key} must be one line of plain text`);
  return { ok: true, value: trimmed };
}

function checkTime(value: unknown): Checked<string | null> {
  if (value === null || value === "") return { ok: true, value: null };
  if (!isValidTime(value)) return fail("time must look like 13:30");
  return { ok: true, value };
}

function unknownField(body: Record<string, unknown>, allowed: readonly string[]): string | undefined {
  return Object.keys(body).find((key) => !allowed.includes(key));
}

const FIELDS = ["date", "type", "title", "tag", "time"] as const;

/** Checks the fields present in a body. Missing keys stay missing. Shared by create and edit. */
function checkFields(body: Record<string, unknown>): Checked<EntryPatch> {
  const out: EntryPatch = {};
  if ("date" in body) {
    if (!isValidDate(body.date)) return fail("date must be a date like 2026-11-20");
    out.date = body.date;
  }
  if ("type" in body) {
    if (!isEntryType(body.type)) return fail(`type must be one of ${ENTRY_TYPES.join(", ")}`);
    out.type = body.type;
  }
  if ("title" in body) {
    const title = checkText("title", body.title, TITLE_MAX, true);
    if (!title.ok) return title;
    out.title = title.value as string;
  }
  if ("tag" in body) {
    const tag = checkText("tag", body.tag, TAG_MAX, false);
    if (!tag.ok) return tag;
    out.tag = tag.value;
  }
  if ("time" in body) {
    const time = checkTime(body.time);
    if (!time.ok) return time;
    out.time = time.value;
  }
  return { ok: true, value: out };
}

/** Checks a create body: date, type and title are required, tag and time are optional. */
export function checkNewEntry(body: Record<string, unknown>): Checked<NewEntry> {
  const extra = unknownField(body, FIELDS);
  if (extra) return fail(extra === "sync" ? "sync cannot be set" : `unknown field: ${extra}`);
  for (const key of ["date", "type", "title"] as const) {
    if (!(key in body)) return fail(`${key} is required`);
  }
  const fields = checkFields(body);
  if (!fields.ok) return fields;
  const { date, type, title, tag = null, time = null } = fields.value;
  return { ok: true, value: { date: date!, type: type!, title: title!, tag, time } };
}

/** Checks an edit body: any of the fields, at least one. Clients cannot set sync. */
export function checkEntryPatch(body: Record<string, unknown>): Checked<EntryPatch> {
  const extra = unknownField(body, FIELDS);
  if (extra) return fail(extra === "sync" ? "sync cannot be set" : `unknown field: ${extra}`);
  if (Object.keys(body).length === 0) return fail("nothing to change");
  return checkFields(body);
}
