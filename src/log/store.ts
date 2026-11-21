import crypto from "node:crypto";
import { inTransaction, type Db } from "../db.ts";
import type { DateRange, Entry, EntryPatch, MoveDirection, NewEntry, RemoteLink, ScanEntry, ScanSnapshot, SyncChange } from "./types.ts";

type Row = {
  id: string;
  date: string;
  time: string | null;
  type: Entry["type"];
  title: string;
  tag: string | null;
  body: string | null;
  has_photo: number;
  sync: Entry["sync"];
  sync_error: string | null;
  position: number;
  indent: number;
  created_at: number;
  updated_at: number;
};

type ScanRow = Row & {
  scan_key: string | null;
  scan_type: Entry["type"] | null;
  scan_title: string | null;
  scan_tag: string | null;
  scan_time: string | null;
  scan_at: number | null;
};

type LinkRow = { remote_href: string | null; remote_uid: string | null; remote_etag: string | null };

export type EntryStore = {
  /** Entries from one day to another, both included, by date then position. */
  list(userId: string, range: DateRange): Entry[];
  /** Every free note of the user (an entry with a non-empty body, whatever its day), newest day first, then newest created. */
  listNotes(userId: string): Entry[];
  /** Like list, with the scan provenance of each entry. For the scan routes only: it never reaches the public API. */
  listScan(userId: string, range: DateRange): ScanEntry[];
  /**
   * Records the paper line a scan last applied to an entry. Not an edit: updated_at and sync stay as they are.
   * Does nothing for an unknown entry.
   */
  setScanProvenance(userId: string, id: string, snapshot: ScanSnapshot): void;
  get(userId: string, id: string): Entry | undefined;
  /** A new entry goes to the end of its day, with sync "local". */
  create(userId: string, input: NewEntry, now: number): Entry;
  /**
   * Changes the fields given. Moving to another day puts the entry at the end of that day, not nested.
   * An indent of 1 is kept only when an entry sits above in the day, otherwise it stays 0.
   */
  update(userId: string, id: string, patch: EntryPatch, now: number): Entry | undefined;
  /**
   * Swaps an entry with its neighbour in the day. At the first or last place it stays where it is.
   * Returns the entries of that day in their new order, or undefined for an unknown entry. Not an edit: no timestamps, no sync.
   */
  move(userId: string, id: string, direction: MoveDirection): Entry[] | undefined;
  /**
   * Removes the entry from the log (its photo goes with it). Local only: nothing on a sync target is touched.
   * Returns the entries left in its day, or undefined for an unknown entry.
   */
  remove(userId: string, id: string): Entry[] | undefined;
  /** Sets the sync state (and the remote link when given). It is not an edit, so updated_at stays. */
  setSync(userId: string, id: string, change: SyncChange): Entry | undefined;
  /** The remote link of an entry, or undefined when it was never pushed. */
  getRemote(userId: string, id: string): RemoteLink | undefined;
  /** Turns every pending entry into an error with this message. For a start after a stop in the middle of a push. */
  failPending(message: string): void;
};

/** The entry columns, plus a flag for a stored photo (the bytes are never selected here). */
const COLUMNS =
  "id, date, time, type, title, tag, body, sync, sync_error, position, indent, created_at, updated_at, " +
  "EXISTS (SELECT 1 FROM entry_photos WHERE entry_id = entries.id) AS has_photo";

/** The order of a day: by position, and by creation time for entries that share a position. */
const DAY_ORDER = "ORDER BY position, created_at, id";

/** The scan provenance columns, selected next to COLUMNS by listScan. */
const SCAN_COLUMNS = "scan_key, scan_type, scan_title, scan_tag, scan_time, scan_at";

/** The snapshot of a row, or null when no scan has been applied to it. */
function toSnapshot(row: ScanRow): ScanSnapshot | null {
  if (row.scan_key === null || row.scan_type === null || row.scan_title === null || row.scan_at === null) return null;
  return { key: row.scan_key, type: row.scan_type, title: row.scan_title, tag: row.scan_tag, time: row.scan_time, at: Number(row.scan_at) };
}

function toEntry(row: Row): Entry {
  return {
    id: row.id,
    date: row.date,
    time: row.time,
    type: row.type,
    title: row.title,
    tag: row.tag,
    body: row.body ?? null,
    hasPhoto: Number(row.has_photo) === 1,
    sync: row.sync,
    syncError: row.sync_error,
    position: Number(row.position),
    indent: Number(row.indent),
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

  /** The ids of one day, in order. */
  function dayIds(userId: string, date: string): string[] {
    const rows = db.prepare(`SELECT id FROM entries WHERE user_id = ? AND date = ? ${DAY_ORDER}`).all(userId, date) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  function dayEntries(userId: string, date: string): Entry[] {
    return (db.prepare(`SELECT ${COLUMNS} FROM entries WHERE user_id = ? AND date = ? ${DAY_ORDER}`).all(userId, date) as Row[]).map(toEntry);
  }

  /** Writes the order of a day as 0..n-1, and clears the indent of the first entry (nothing above it to nest under). */
  function renumber(userId: string, ids: string[]): void {
    const write = db.prepare("UPDATE entries SET position = ?, indent = CASE WHEN ? = 0 THEN 0 ELSE indent END WHERE user_id = ? AND id = ?");
    ids.forEach((id, index) => write.run(index, index, userId, id));
  }

  /** An indent of 1 only stands when an entry sits above in the day. */
  function settleIndent(userId: string, entry: Entry): void {
    if (entry.indent === 1 && dayIds(userId, entry.date).indexOf(entry.id) <= 0) {
      db.prepare("UPDATE entries SET indent = 0 WHERE user_id = ? AND id = ?").run(userId, entry.id);
    }
  }

  return {
    list(userId, range) {
      const rows = db
        .prepare(`SELECT ${COLUMNS} FROM entries WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date, position, created_at, id`)
        .all(userId, range.from, range.to) as Row[];
      return rows.map(toEntry);
    },

    listNotes(userId) {
      const rows = db
        .prepare(`SELECT ${COLUMNS} FROM entries WHERE user_id = ? AND body IS NOT NULL AND body <> '' ORDER BY date DESC, created_at DESC, id DESC`)
        .all(userId) as Row[];
      return rows.map(toEntry);
    },

    get,

    listScan(userId, range) {
      const rows = db
        .prepare(`SELECT ${COLUMNS}, ${SCAN_COLUMNS} FROM entries WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date, position, created_at, id`)
        .all(userId, range.from, range.to) as ScanRow[];
      return rows.map((row) => ({ ...toEntry(row), scan: toSnapshot(row) }));
    },

    setScanProvenance(userId, id, snapshot) {
      db.prepare("UPDATE entries SET scan_key = ?, scan_type = ?, scan_title = ?, scan_tag = ?, scan_time = ?, scan_at = ? WHERE user_id = ? AND id = ?").run(
        snapshot.key,
        snapshot.type,
        snapshot.title,
        snapshot.tag,
        snapshot.time,
        snapshot.at,
        userId,
        id,
      );
    },

    create(userId, input, now) {
      const id = crypto.randomUUID();
      db.prepare(
        "INSERT INTO entries (id, user_id, date, time, type, title, tag, body, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(id, userId, input.date, input.time, input.type, input.title, input.tag, input.body ?? null, nextPosition(userId, input.date), now, now);
      return get(userId, id)!;
    },

    update(userId, id, patch, now) {
      const current = get(userId, id);
      if (!current) return undefined;
      const next = { ...current, ...patch };
      const sameDay = next.date === current.date;
      const position = sameDay ? current.position : nextPosition(userId, next.date);
      const indent = sameDay ? next.indent : (patch.indent ?? 0);
      db.prepare("UPDATE entries SET date = ?, time = ?, type = ?, title = ?, tag = ?, body = ?, position = ?, indent = ?, updated_at = ? WHERE user_id = ? AND id = ?").run(
        next.date,
        next.time,
        next.type,
        next.title,
        next.tag,
        next.body,
        position,
        indent,
        now,
        userId,
        id,
      );
      settleIndent(userId, get(userId, id)!);
      if (!sameDay) renumber(userId, dayIds(userId, current.date));
      return get(userId, id);
    },

    move(userId, id, direction) {
      const current = get(userId, id);
      if (!current) return undefined;
      const ids = dayIds(userId, current.date);
      const from = ids.indexOf(id);
      const to = direction === "up" ? from - 1 : from + 1;
      if (to >= 0 && to < ids.length) {
        [ids[from], ids[to]] = [ids[to], ids[from]];
        inTransaction(db, () => renumber(userId, ids));
      }
      return dayEntries(userId, current.date);
    },

    remove(userId, id) {
      const current = get(userId, id);
      if (!current) return undefined;
      inTransaction(db, () => {
        db.prepare("DELETE FROM entries WHERE user_id = ? AND id = ?").run(userId, id);
        renumber(userId, dayIds(userId, current.date));
      });
      return dayEntries(userId, current.date);
    },

    setSync(userId, id, change) {
      const error = change.sync === "error" ? (change.error ?? null) : null;
      if (change.link) {
        db.prepare("UPDATE entries SET sync = ?, sync_error = ?, remote_href = ?, remote_uid = ?, remote_etag = ? WHERE user_id = ? AND id = ?").run(
          change.sync,
          error,
          change.link.href,
          change.link.uid,
          change.link.etag,
          userId,
          id,
        );
      } else {
        db.prepare("UPDATE entries SET sync = ?, sync_error = ? WHERE user_id = ? AND id = ?").run(change.sync, error, userId, id);
      }
      return get(userId, id);
    },

    getRemote(userId, id) {
      const row = db.prepare("SELECT remote_href, remote_uid, remote_etag FROM entries WHERE user_id = ? AND id = ?").get(userId, id) as
        | LinkRow
        | undefined;
      if (!row || row.remote_href === null || row.remote_uid === null) return undefined;
      return { href: row.remote_href, uid: row.remote_uid, etag: row.remote_etag };
    },

    failPending(message) {
      db.prepare("UPDATE entries SET sync = 'error', sync_error = ? WHERE sync = 'pending'").run(message);
    },
  };
}
