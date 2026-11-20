import crypto from "node:crypto";
import type { Db } from "../db.ts";
import type { DateRange, Entry, EntryPatch, NewEntry } from "./types.ts";

type Row = {
  id: string;
  date: string;
  time: string | null;
  type: Entry["type"];
  title: string;
  tag: string | null;
  sync: Entry["sync"];
  position: number;
  created_at: number;
  updated_at: number;
};

export type EntryStore = {
  /** Entries from one day to another, both included, by date then position. */
  list(userId: string, range: DateRange): Entry[];
  get(userId: string, id: string): Entry | undefined;
  /** A new entry goes to the end of its day, with sync "local". */
  create(userId: string, input: NewEntry, now: number): Entry;
  /** Changes the fields given. Moving to another day puts the entry at the end of that day. */
  update(userId: string, id: string, patch: EntryPatch, now: number): Entry | undefined;
};

const COLUMNS = "id, date, time, type, title, tag, sync, position, created_at, updated_at";

function toEntry(row: Row): Entry {
  return {
    id: row.id,
    date: row.date,
    time: row.time,
    type: row.type,
    title: row.title,
    tag: row.tag,
    sync: row.sync,
    position: Number(row.position),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

/** The entries table, always scoped to one user. */
export function createEntryStore(db: Db): EntryStore {
  function nextPosition(userId: string, date: string): number {
    const row = db.prepare("SELECT MAX(position) AS top FROM entries WHERE user_id = ? AND date = ?").get(userId, date) as {
      top: number | null;
    };
    return row.top === null ? 0 : Number(row.top) + 1;
  }

  function get(userId: string, id: string): Entry | undefined {
    const row = db.prepare(`SELECT ${COLUMNS} FROM entries WHERE user_id = ? AND id = ?`).get(userId, id) as Row | undefined;
    return row ? toEntry(row) : undefined;
  }

  return {
    list(userId, range) {
      const rows = db
        .prepare(`SELECT ${COLUMNS} FROM entries WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date, position, created_at`)
        .all(userId, range.from, range.to) as Row[];
      return rows.map(toEntry);
    },

    get,

    create(userId, input, now) {
      const id = crypto.randomUUID();
      db.prepare(
        "INSERT INTO entries (id, user_id, date, time, type, title, tag, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(id, userId, input.date, input.time, input.type, input.title, input.tag, nextPosition(userId, input.date), now, now);
      return get(userId, id)!;
    },

    update(userId, id, patch, now) {
      const current = get(userId, id);
      if (!current) return undefined;
      const next = { ...current, ...patch };
      const position = next.date === current.date ? current.position : nextPosition(userId, next.date);
      db.prepare("UPDATE entries SET date = ?, time = ?, type = ?, title = ?, tag = ?, position = ?, updated_at = ? WHERE user_id = ? AND id = ?").run(
        next.date,
        next.time,
        next.type,
        next.title,
        next.tag,
        position,
        now,
        userId,
        id,
      );
      return get(userId, id);
    },
  };
}
