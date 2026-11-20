import { buildNewTodo, parseVTodos, type TodoPatch } from "../caldav/ics.ts";
import type { Entry, EntryType } from "../log/types.ts";
import { mismatchReason } from "./strings.ts";

/** The entry types that become a VTODO. Notes never sync, events wait until the VEVENT conventions are agreed. */
const SYNCED_TYPES: readonly EntryType[] = ["task", "done", "migrated", "scheduled"];

export function isSyncable(type: EntryType): boolean {
  return SYNCED_TYPES.includes(type);
}

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

/** A whole new VCALENDAR for an entry. No DTSTART, PRIORITY or CATEGORIES: the tag is not mapped. */
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
