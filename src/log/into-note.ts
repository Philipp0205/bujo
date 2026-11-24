import { inTransaction, type Db } from "../db.ts";
import { createEntryStore, type EntryStore } from "./store.ts";
import type { Entry, EntryType } from "./types.ts";
import { BODY_MAX } from "./validation.ts";

/** The types of the task family: the entries that can be filed into a note as a line. */
const FILEABLE: readonly EntryType[] = ["task", "done", "migrated", "scheduled"];

const MESSAGES = {
  unknownEntry: "unknown entry",
  unknownNote: "unknown note",
  notFileable: "only a task can be filed into a note",
  notFreeNote: "that entry is not a free-form note",
  tooLong: `the note would be too long (at most ${BODY_MAX} characters)`,
};

export type Filing = { ok: true; entry: Entry; note: Entry; body: string } | { ok: false; status: number; error: string };

const fail = (status: number, error: string): Filing => ({ ok: false, status, error });

/** True when a note already reads as a markdown list: some line starts with a bullet. Then a filed task is a bullet too. */
function looksLikeList(body: string): boolean {
  return body.split("\n").some((line) => /^\s*[-*+] /.test(line));
}

/** The body with the title added as a new last line: a bullet in a list-like note, the plain title otherwise. Never a link. */
export function appendLine(body: string, title: string): string {
  const line = looksLikeList(body) ? `- ${title}` : title;
  return `${body}${body.endsWith("\n") ? "" : "\n"}${line}\n`;
}

/** Checks a filing before anything changes: the task, a free-form note as the target (a body, not a dash note) and room in the body. */
export function checkFiling(store: EntryStore, userId: string, id: string, noteId: string): Filing {
  const entry = store.get(userId, id);
  if (!entry) return fail(404, MESSAGES.unknownEntry);
  if (!FILEABLE.includes(entry.type) || entry.body) return fail(400, MESSAGES.notFileable);
  const note = store.get(userId, noteId);
  if (!note) return fail(404, MESSAGES.unknownNote);
  if (!note.body) return fail(400, MESSAGES.notFreeNote);
  const body = appendLine(note.body, entry.title);
  if (body.length > BODY_MAX) return fail(400, MESSAGES.tooLong);
  return { ok: true, entry, note, body };
}

/** Writes the new body on the note and removes the task from the log in one transaction. Local only: nothing is deleted on Nextcloud. */
export function commitFiling(db: Db, userId: string, filing: Extract<Filing, { ok: true }>, now: number): { note: Entry; day: Entry[] } {
  const store = createEntryStore(db);
  return inTransaction(db, () => {
    const note = store.update(userId, filing.note.id, { body: filing.body }, now)!;
    return { note, day: store.remove(userId, filing.entry.id) ?? [] };
  });
}
