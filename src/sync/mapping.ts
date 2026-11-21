import { buildNewTodo, parseVTodos, type TodoPatch } from "../caldav/ics.ts";
import { buildNewEvent, eventDifferences, parseVEvents, type EventFields } from "../caldav/vevent.ts";
import type { Entry, EntryType } from "../log/types.ts";
import { mismatchReason } from "./strings.ts";

/** What an entry type becomes in Nextcloud: a VTODO, a VEVENT, or nothing (notes stay local). */
export type SyncKind = "todo" | "event";

/** The entry types that become a VTODO. */
const TODO_TYPES: readonly EntryType[] = ["task", "done", "migrated", "scheduled"];

/** The kind of calendar object an entry type is written as, or null for a type that stays local. */
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
  status: "NEEDS-ACTION" | "COMPLETED";
  /** YYYY-MM-DD for DUE;VALUE=DATE, or null for no DUE. */
  due: string | null;
};

/** The VTODO an entry stands for. done is finished, scheduled has a DUE day, task and migrated are open with none. */
export function todoShape(entry: Pick<Entry, "type" | "title" | "date">): TodoShape {
  return {
    summary: entry.title,
    status: entry.type === "done" ? "COMPLETED" : "NEEDS-ACTION",
    due: entry.type === "scheduled" ? entry.date : null,
  };
}

/** A whole new VCALENDAR for an entry. No DTSTART, PRIORITY or CATEGORIES: the tags are not mapped. */
export function newTodoFor(shape: TodoShape, uid: string, nowMs: number): string {
  return buildNewTodo({ uid, summary: shape.summary, due: shape.due, complete: shape.status === "COMPLETED" }, nowMs);
}

/** The edit that turns an existing VTODO into this shape. Everything else on the object stays as it is. */
export function patchFor(shape: TodoShape): TodoPatch {
  return {
    summary: shape.summary,
    due: shape.due,
    ...(shape.status === "COMPLETED" ? { complete: true } : { reopen: true }),
  };
}

/** Compares a calendar object read back from the server with what was written. Null when it matches, else what differs. */
export function readBackMismatch(text: string, uid: string, shape: TodoShape): string | null {
  const todo = parseVTodos(text).find((item) => item.uid === uid);
  if (!todo) return mismatchReason("UID");
  if (todo.summary !== shape.summary) return mismatchReason("SUMMARY");
  if (todo.status !== shape.status) return mismatchReason("STATUS");
  if ((todo.due?.date ?? null) !== shape.due) return mismatchReason("DUE");
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
