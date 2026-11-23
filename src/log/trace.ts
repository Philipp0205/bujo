import crypto from "node:crypto";
import type { Db } from "../db.ts";
import type { DateRange, Entry, EntryHorizon, Trace, TraceKind } from "./types.ts";

type Row = { id: string; entry_id: string; date: string; horizon: EntryHorizon; kind: TraceKind; title: string; created_at: number };

export type TraceStore = {
  /** The traces on the pages from one day to another, both included, oldest first within a page. */
  list(userId: string, range: DateRange): Trace[];
  /** Leaves a trace of an entry on the page it is leaving: its date, horizon and title as they are now. */
  record(userId: string, entry: Entry, kind: TraceKind, now: number): Trace;
  /** Takes the moved and scheduled traces of an entry off one page (the entry came back to it, so the page holds the entry itself). A collected trace stays: it belongs to a collection, not to a moving entry. */
  clearAt(userId: string, entryId: string, date: string, horizon: EntryHorizon): void;
};

function toTrace(row: Row): Trace {
  return { id: row.id, entryId: row.entry_id, date: row.date, horizon: row.horizon, kind: row.kind, title: row.title, createdAt: Number(row.created_at) };
}

/** The entry_traces table, always scoped to one user. Traces are local notes: nothing here touches the sync target. */
export function createTraceStore(db: Db): TraceStore {
  return {
    list(userId, range) {
      const rows = db
        .prepare("SELECT id, entry_id, date, horizon, kind, title, created_at FROM entry_traces WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date, horizon, created_at, id")
        .all(userId, range.from, range.to) as Row[];
      return rows.map(toTrace);
    },

    record(userId, entry, kind, now) {
      const id = crypto.randomUUID();
      db.prepare("INSERT INTO entry_traces (id, user_id, entry_id, date, horizon, kind, title, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
        id,
        userId,
        entry.id,
        entry.date,
        entry.horizon,
        kind,
        entry.title,
        now,
      );
      return { id, entryId: entry.id, date: entry.date, horizon: entry.horizon, kind, title: entry.title, createdAt: now };
    },

    clearAt(userId, entryId, date, horizon) {
      db.prepare("DELETE FROM entry_traces WHERE user_id = ? AND entry_id = ? AND date = ? AND horizon = ? AND kind <> 'collected'").run(userId, entryId, date, horizon);
    },
  };
}
