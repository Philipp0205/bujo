import { HttpError } from "../app-kit/http.ts";
import { CalDavError } from "../caldav/client.ts";
import { isIsoDate, type NewTodo, type Priority, type Task, type TodoPatch } from "../caldav/ics.ts";
import {
  loadBacklog,
  TaskConflictError,
  TaskNotFoundError,
  toView,
  UnknownListError,
  type TaskSource,
  type TaskView,
} from "../caldav/source.ts";

/**
 * The task API. Plain functions over a TaskSource, shared by /api/v1 and the MCP tools.
 * Every function takes raw, unchecked input and validates it itself: a bad value is an HttpError 400,
 * a missing task 404, a task that changed meanwhile 409, a task server that fails 502.
 * There is no delete function. There is nothing here that could become one.
 */

export const SUMMARY_MAX = 500;
export const DESCRIPTION_MAX = 10_000;
export const TAG_MAX = 60;
export const TAGS_MAX = 20;
/** The default list when none is named. */
export const DEFAULT_LIST = "Aufgaben";

export type Raw = Record<string, unknown>;
type Where = "path" | "input";

/** Maps what the task source throws to an HttpError. Everything else passes through (it becomes a 500). */
export async function guard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof TaskNotFoundError) throw new HttpError(404, "task not found");
    if (error instanceof TaskConflictError) throw new HttpError(409, error.message);
    if (error instanceof UnknownListError) throw new HttpError(404, error.message);
    if (error instanceof CalDavError) {
      // The message names the method and status only. It never holds the URL or credentials.
      console.error("task server failed:", error.message);
      throw new HttpError(502, "The task server did not answer. Try again in a moment.");
    }
    throw error;
  }
}

export function defaultList(source: TaskSource): string {
  return source.listNames.includes(DEFAULT_LIST) ? DEFAULT_LIST : source.listNames[0];
}

/** A list name that exists. Nothing named means the default. A wrong name is 404 in a path and 400 in the input. */
function resolveList(source: TaskSource, value: unknown, where: Where): string {
  if (value === undefined || value === null || value === "") return defaultList(source);
  if (typeof value !== "string") throw new HttpError(400, "list must be a string");
  if (!source.listNames.includes(value)) {
    throw new HttpError(where === "path" ? 404 : 400, `unknown list "${value.slice(0, 80)}". Lists: ${source.listNames.join(", ")}`);
  }
  return value;
}

function onlyKeys(input: Raw, allowed: readonly string[]): void {
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) throw new HttpError(400, `unknown field: ${key.slice(0, 40)}`);
  }
}

function asObject(input: unknown): Raw {
  if (input === undefined || input === null) return {};
  if (typeof input !== "object" || Array.isArray(input)) throw new HttpError(400, "expected an object");
  return input as Raw;
}

// Plain text with no control characters other than the line breaks and tabs a description may hold.
const CONTROL_ANY = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const CONTROL_LINE = /[\u0000-\u001f\u007f\u2028\u2029]/;

function parseSummary(value: unknown): string {
  if (typeof value !== "string") throw new HttpError(400, "summary must be a string");
  const text = value.trim();
  if (text === "") throw new HttpError(400, "summary must not be empty");
  if (text.length > SUMMARY_MAX) throw new HttpError(400, `summary is too long (at most ${SUMMARY_MAX} characters)`);
  if (CONTROL_LINE.test(text)) throw new HttpError(400, "summary must be a single line of plain text");
  return text;
}

/** null and "" both mean no description. */
function parseDescription(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new HttpError(400, "description must be a string or null");
  if (value.trim() === "") return null;
  if (value.length > DESCRIPTION_MAX) throw new HttpError(400, `description is too long (at most ${DESCRIPTION_MAX} characters)`);
  if (CONTROL_ANY.test(value)) throw new HttpError(400, "description must be plain text");
  return value;
}

function parseDue(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !isIsoDate(value)) throw new HttpError(400, "due must be a real date as YYYY-MM-DD, or null");
  return value;
}

function parsePriority(value: unknown): Priority | null {
  if (value === null) return null;
  if (value === 1 || value === 5 || value === 9) return value;
  throw new HttpError(400, "priority must be 1 (high), 5 (medium), 9 (low) or null");
}

function parseTags(value: unknown): string[] {
  if (!Array.isArray(value)) throw new HttpError(400, "tags must be an array of strings");
  const tags: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") throw new HttpError(400, "tags must be an array of strings");
    const tag = item.trim();
    if (tag === "") throw new HttpError(400, "a tag must not be empty");
    if (tag.length > TAG_MAX) throw new HttpError(400, `a tag is too long (at most ${TAG_MAX} characters)`);
    if (CONTROL_LINE.test(tag)) throw new HttpError(400, "a tag must be a single line of plain text");
    if (!tags.includes(tag)) tags.push(tag);
  }
  if (tags.length > TAGS_MAX) throw new HttpError(400, `too many tags (at most ${TAGS_MAX})`);
  return tags;
}

function parseBool(value: unknown, name: string): boolean {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new HttpError(400, `${name} must be true or false`);
}

function parseStatus(value: unknown): boolean {
  if (value === undefined || value === "open") return false;
  if (value === "all") return true;
  throw new HttpError(400, "status must be open or all");
}

function parseUid(value: unknown): string {
  if (typeof value !== "string" || value === "" || value.length > 255 || CONTROL_LINE.test(value)) {
    throw new HttpError(400, "uid must be a task id");
  }
  return value;
}

/* ---------- reads ---------- */

const LIST_QUERY = ["list", "status", "tag", "someday"] as const;

/** Open tasks by default, sorted as the backlog is (due date, priority, list, summary). */
export async function listTasks(source: TaskSource, rawQuery: unknown): Promise<{ tasks: TaskView[] }> {
  const query = asObject(rawQuery);
  onlyKeys(query, LIST_QUERY);
  const includeClosed = parseStatus(query.status);
  const list = query.list === undefined ? undefined : resolveList(source, query.list, "input");
  const tag = query.tag === undefined ? undefined : parseTags([query.tag])[0];
  const someday = query.someday === undefined ? undefined : parseBool(query.someday, "someday");
  const tasks = await guard(() => loadBacklog(source, includeClosed));
  return {
    tasks: tasks.filter(
      (task) =>
        (list === undefined || task.list === list) &&
        (tag === undefined || task.tags.some((item) => item.toLowerCase() === tag.toLowerCase())) &&
        (someday === undefined || task.someday === someday),
    ),
  };
}

export async function getTask(source: TaskSource, listName: unknown, uid: unknown): Promise<{ task: TaskView }> {
  const list = resolveList(source, listName, "path");
  const task = await guard(() => source.get(list, parseUid(uid)));
  if (!task) throw new HttpError(404, "task not found");
  return { task: viewOf(task) };
}

/** Each tag with the number of tasks that carry it. Open tasks by default. */
export async function listTags(source: TaskSource, rawQuery: unknown): Promise<{ tags: Array<{ tag: string; count: number }> }> {
  const query = asObject(rawQuery);
  onlyKeys(query, ["list", "status"]);
  const { tasks } = await listTasks(source, query);
  const counts = new Map<string, number>();
  for (const task of tasks) for (const tag of task.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return {
    tags: [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => a.tag.localeCompare(b.tag, "de")),
  };
}

export function listLists(source: TaskSource): { lists: Array<{ name: string; default: boolean }>; source: string } {
  const fallback = defaultList(source);
  return { source: source.kind, lists: source.listNames.map((name) => ({ name, default: name === fallback })) };
}

/* ---------- writes ---------- */

function viewOf(task: Task): TaskView {
  return toView(task);
}

const CREATE_KEYS = ["list", "summary", "description", "due", "priority", "tags", "someday"] as const;
const UPDATE_KEYS = ["summary", "description", "due", "priority", "tags", "someday"] as const;

export async function createTask(source: TaskSource, rawBody: unknown): Promise<{ task: TaskView }> {
  const body = asObject(rawBody);
  onlyKeys(body, CREATE_KEYS);
  const list = resolveList(source, body.list, "input");
  const input: Omit<NewTodo, "uid"> = { summary: parseSummary(body.summary) };
  if (body.description !== undefined) input.description = parseDescription(body.description);
  if (body.due !== undefined) input.due = parseDue(body.due);
  if (body.priority !== undefined) input.priority = parsePriority(body.priority);
  const tags = body.tags === undefined ? [] : parseTags(body.tags);
  // Someday is a plain tag in the file, so on a new task it is added to the list.
  if (body.someday !== undefined && parseBool(body.someday, "someday") && !tags.some((tag) => tag.toLowerCase() === "someday")) {
    tags.push("someday");
  }
  if (tags.length > TAGS_MAX) throw new HttpError(400, `too many tags (at most ${TAGS_MAX})`);
  if (tags.length > 0) input.categories = tags;
  const task = await guard(() => source.create(list, input));
  return { task: viewOf(task) };
}

/** The list is part of the address and cannot change: sending `list` in the body is a 400. */
export async function updateTask(source: TaskSource, listName: unknown, uid: unknown, rawBody: unknown): Promise<{ task: TaskView }> {
  const list = resolveList(source, listName, "path");
  const id = parseUid(uid);
  const body = asObject(rawBody);
  if ("list" in body) throw new HttpError(400, "a task cannot move to another list");
  onlyKeys(body, UPDATE_KEYS);
  const patch: TodoPatch = {};
  if (body.summary !== undefined) patch.summary = parseSummary(body.summary);
  if (body.description !== undefined) patch.description = parseDescription(body.description);
  if (body.due !== undefined) patch.due = parseDue(body.due);
  if (body.priority !== undefined) patch.priority = parsePriority(body.priority);
  if (body.tags !== undefined) patch.categories = parseTags(body.tags);
  if (body.someday !== undefined) patch.someday = parseBool(body.someday, "someday");
  if (Object.keys(patch).length === 0) throw new HttpError(400, "nothing to change");
  const task = await guard(() => source.update(list, id, patch));
  return { task: viewOf(task) };
}

/** Marks the task done. Doing it again changes nothing and writes nothing. */
export async function completeTask(source: TaskSource, listName: unknown, uid: unknown): Promise<{ task: TaskView }> {
  const list = resolveList(source, listName, "path");
  const id = parseUid(uid);
  const task = await guard(async () => {
    const existing = await source.get(list, id);
    if (!existing) throw new TaskNotFoundError();
    if (existing.status === "COMPLETED") return existing;
    return await source.update(list, id, { complete: true });
  });
  return { task: viewOf(task) };
}
