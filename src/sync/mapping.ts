import { buildNewTodo, parseVTodos, type Priority, type TodoPatch } from "../caldav/ics.ts";
import { buildNewEvent, eventDifferences, parseVEvents, type EventFields } from "../caldav/vevent.ts";
import { isDayDated } from "../log/horizon.ts";
import type { Entry, EntryType } from "../log/types.ts";
import { mismatchReason } from "./strings.ts";

/** What an entry type becomes in Nextcloud: a VTODO, a VEVENT, or nothing (notes stay local). */
export type SyncKind = "todo" | "event";

/** The entry types that become a VTODO. */
const TODO_TYPES: readonly EntryType[] = ["task", "done", "migrated", "scheduled", "dropped"];

/** The kind of calendar object an entry type is written as, or null for a type that stays local. Indent (nesting under the entry above) is local on purpose: it never maps to RELATED-TO or DESCRIPTION. */
export function syncKind(type: EntryType): SyncKind | null {
  if (type === "event") return "event";
  return TODO_TYPES.includes(type) ? "todo" : null;
}

export function isSyncable(type: EntryType): boolean {
  return syncKind(type) !== null;
}

/** The category every event written by bujo carries, so it can be found in the calendar. */
export const EVENT_CATEGORY = "bujo";

/** What the VTODO must say for an entry: the part the read-back checks. */
export type TodoShape = {
  summary: string;
  status: "NEEDS-ACTION" | "COMPLETED" | "CANCELLED";
  /** YYYY-MM-DD for DUE;VALUE=DATE, or null for no DUE. */
  due: string | null;
  /** True writes PRIORITY:1. False writes none on create and leaves a remote PRIORITY alone. */
  important: boolean;
};

/**
 * The VTODO an entry stands for. done is finished, dropped is CANCELLED. scheduled has a DUE day. A task, done or migrated entry of a month or
 * the future has DUE = the last day of its month (its date). A plain task on a real day (daily log or monthly calendar) has no DUE.
 * An important entry has PRIORITY:1 (the RFC high bucket), whatever its status.
 */
export function todoShape(entry: Pick<Entry, "type" | "title" | "date"> & { horizon?: Entry["horizon"]; important?: boolean }): TodoShape {
  const inMonth = entry.horizon !== undefined && !isDayDated(entry.horizon);
  return {
    summary: entry.title,
    status: statusOf(entry.type),
    due: entry.type === "scheduled" || inMonth ? entry.date : null,
    important: entry.important === true,
  };
}

/** The VTODO STATUS an entry type is written with. */
function statusOf(type: EntryType): TodoShape["status"] {
  if (type === "done") return "COMPLETED";
  return type === "dropped" ? "CANCELLED" : "NEEDS-ACTION";
}

/** A whole new VCALENDAR for an entry. PRIORITY:1 only when important; no DTSTART or CATEGORIES: the tags are not mapped. */
export function newTodoFor(shape: TodoShape, uid: string, nowMs: number): string {
  const todo = { uid, summary: shape.summary, due: shape.due, priority: shape.important ? (1 as const) : null };
  return buildNewTodo({ ...todo, complete: shape.status === "COMPLETED", cancel: shape.status === "CANCELLED" }, nowMs);
}

/**
 * The edit that turns an existing VTODO into this shape. Everything else on the object stays as it is.
 * Important sets PRIORITY:1, replacing a remote 5 or 9 (a remote 2 is already in the high band and may stay).
 * Not important never removes a remote 1-4: no mark means "not marked", not "unmark". Only an explicit unflag does.
 * A remote 5 to 9 is left alone either way.
 */
export function patchFor(shape: TodoShape, remotePriority: Priority | null = null, unflag = false): TodoPatch {
  const status = shape.status === "COMPLETED" ? { complete: true } : shape.status === "CANCELLED" ? { cancel: true } : { reopen: true };
  const clear = unflag && remotePriority === 1 ? { priority: null } : {};
  const priority = shape.important ? { priority: 1 as const } : clear;
  return { summary: shape.summary, due: shape.due, ...priority, ...status };
}

/** The PRIORITY bucket of a VTODO in a calendar text, or null when it has none. */
export function remotePriorityOf(text: string, uid: string): Priority | null {
  return parseVTodos(text).find((item) => item.uid === uid)?.priority ?? null;
}

/** True when a raw PRIORITY is in the RFC high band 1-4, which bujo reads as important. */
function isHighBand(raw: number | null): boolean {
  return raw !== null && raw >= 1 && raw <= 4;
}

/** True when the VTODO in a calendar text has a PRIORITY of 1 to 4 (read as important). */
export function remoteImportantOf(text: string, uid: string): boolean {
  return isHighBand(parseVTodos(text).find((item) => item.uid === uid)?.rawPriority ?? null);
}

/**
 * Compares a calendar object read back from the server with what was written. Null when it matches, else what differs.
 * An entry that is not important accepts a remote 1-4 that was left in place, unless it was explicitly unflagged.
 */
export function readBackMismatch(text: string, uid: string, shape: TodoShape, unflag = false): string | null {
  const todo = parseVTodos(text).find((item) => item.uid === uid);
  if (!todo) return mismatchReason("UID");
  if (todo.summary !== shape.summary) return mismatchReason("SUMMARY");
  if (todo.status !== shape.status) return mismatchReason("STATUS");
  if ((todo.due?.date ?? null) !== shape.due) return mismatchReason("DUE");
  const high = isHighBand(todo.rawPriority);
  if (shape.important ? !high : unflag && high) return mismatchReason("PRIORITY");
  return null;
}

/** The VEVENT an entry stands for: its id, title, day, optional time, and the categories bujo plus every tag, in order. */
export function eventFieldsFor(entry: Pick<Entry, "id" | "title" | "date" | "time" | "tags">): EventFields {
  const tags = entry.tags.map((tag) => tag.trim()).filter((tag) => tag !== "" && tag !== EVENT_CATEGORY);
  const categories = [EVENT_CATEGORY, ...tags];
  return { entryId: entry.id, summary: entry.title, date: entry.date, time: entry.time, categories };
}

/** A whole new VCALENDAR for an event entry. */
export function newEventFor(fields: EventFields, uid: string, nowMs: number): string {
  return buildNewEvent({ ...fields, uid }, nowMs);
}

/** Compares a calendar object read back with what was written. Null when it matches, else the fields that differ. */
export function eventReadBackMismatch(text: string, uid: string, fields: EventFields): string | null {
  const event = parseVEvents(text).find((item) => item.uid === uid);
  if (!event) return mismatchReason("UID");
  const differences = event.entryId === fields.entryId ? eventDifferences(event, fields) : ["X-BUJO-ID"];
  return differences.length === 0 ? null : mismatchReason(differences.join(", "));
}
