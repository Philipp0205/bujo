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
/** The most tags one entry carries. */
export const TAGS_MAX = 10;
/** The longest free-note markdown, in characters. */
export const BODY_MAX = 50_000;
/** The widest list request, in days from the first to the last day, inclusive. */
export const RANGE_MAX_DAYS = 92;

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_SHAPE = /^([01]\d|2[0-3]):[0-5]\d$/;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const BODY_CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
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

const FIELDS = ["date", "type", "title", "tags", "time", "body"] as const;
const PATCH_FIELDS = [...FIELDS, "indent"] as const;

/** Checks a list of tags: each one line, trimmed, within TAG_MAX; repeats (ignoring case) dropped; at most TAGS_MAX. */
function checkTags(value: unknown): Checked<string[]> {
  if (!Array.isArray(value)) return fail("tags must be a list of text");
  const tags: string[] = [];
  for (const item of value) {
    const tag = checkText("tag", item, TAG_MAX, true);
    if (!tag.ok) return tag as Checked<string[]>;
    const text = tag.value as string;
    if (!tags.some((have) => have.toLowerCase() === text.toLowerCase())) tags.push(text);
  }
  if (tags.length > TAGS_MAX) return fail(`tags has too many entries (at most ${TAGS_MAX})`);
  return { ok: true, value: tags };
}

/** The markdown body of a free note: any text up to BODY_MAX, line breaks and tabs allowed. Blank means none. */
function checkBody(value: unknown): Checked<string | null> {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== "string") return fail("body must be text");
  if (value.trim() === "") return { ok: true, value: null };
  if (value.length > BODY_MAX) return fail(`body is too long (at most ${BODY_MAX} characters)`);
  if (BODY_CONTROL_CHARS.test(value)) return fail("body must be plain text");
  return { ok: true, value: value.replace(/\r\n?/g, "\n") };
}

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
  if ("tags" in body) {
    const tags = checkTags(body.tags);
    if (!tags.ok) return tags;
    out.tags = tags.value;
  }
  if ("time" in body) {
    const time = checkTime(body.time);
    if (!time.ok) return time;
    out.time = time.value;
  }
  if ("body" in body) {
    const text = checkBody(body.body);
    if (!text.ok) return text;
    out.body = text.value;
  }
  if ("indent" in body) {
    if (body.indent !== 0 && body.indent !== 1) return fail("indent must be 0 or 1");
    out.indent = body.indent;
  }
  return { ok: true, value: out };
}

/** The error for a body that names a field it may not: the old single "tag", "sync", or any other unknown key. */
function badField(body: Record<string, unknown>, allowed: readonly string[]): string | null {
  const extra = unknownField(body, allowed);
  if (extra === undefined) return null;
  if (extra === "sync") return "sync cannot be set";
  return extra === "tag" ? "tag is gone: send tags, a list of text" : `unknown field: ${extra}`;
}

/** Checks a create body: date, type and title are required, tags and time are optional. */
export function checkNewEntry(body: Record<string, unknown>): Checked<NewEntry> {
  const bad = badField(body, FIELDS);
  if (bad) return fail(bad);
  for (const key of ["date", "type", "title"] as const) {
    if (!(key in body)) return fail(`${key} is required`);
  }
  const fields = checkFields(body);
  if (!fields.ok) return fields;
  const { date, type, title, tags = [], time = null, body: text = null } = fields.value;
  return { ok: true, value: { date: date!, type: type!, title: title!, tags, time, body: text } };
}

/** Checks an edit body: any of the fields (and indent, which a create cannot set), at least one. Clients cannot set sync. */
export function checkEntryPatch(body: Record<string, unknown>): Checked<EntryPatch> {
  const bad = badField(body, PATCH_FIELDS);
  if (bad) return fail(bad);
  if (Object.keys(body).length === 0) return fail("nothing to change");
  return checkFields(body);
}
