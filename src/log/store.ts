import crypto from "node:crypto";
import { inTransaction, type Db } from "../db.ts";
import { onPaper } from "./paper.ts";
import { originOf } from "./origin.ts";
import { settleHorizon } from "./horizon.ts";
import { createNotebookStore } from "./notebooks.ts";
import type { DateRange, Entry, EntryHorizon, EntryPatch, EntrySection, MoveDirection, NewEntry, NoteKind, RemoteLink, ScanEntry, ScanSnapshot, SyncChange, TagUse } from "./types.ts";

/** A row with the scan provenance columns: the store reads them to derive onPaper, and listScan to hand out the snapshot. */
type Row = {
  id: string;
  date: string;
  horizon: EntryHorizon | null;
  time: string | null;
  type: Entry["type"];
  title: string;
  tags_json: string;
  body: string | null;
  note_kind: NoteKind | null;
  section: EntrySection | null;
  collection_id: string | null;
  important: number;
  has_photo: number;
  sync: Entry["sync"];
  sync_error: string | null;
  position: number;
  paper_page: number | null;
  indent: number;
  created_at: number;
  updated_at: number;
  scan_key: string | null;
  scan_type: Entry["type"] | null;
  scan_title: string | null;
  scan_tags: string | null;
  scan_time: string | null;
  scan_at: number | null;
  origin: string | null;
};

type LinkRow = { remote_href: string | null; remote_uid: string | null; remote_etag: string | null };

/** A client-made entry id that another user already holds. The message is safe to show. */
export class EntryIdTaken extends Error {
  constructor() {
    super("that id is taken");
    this.name = "EntryIdTaken";
  }
}

export type EntryStore = {
  /** Entries from one day to another, both included, by date then position. */
  list(userId: string, range: DateRange): Entry[];
  /** Every open task of the daily log from a day before `before`, with no limit on how far back, oldest day first then page order. For the migration review. */
  listOpenBefore(userId: string, before: string): Entry[];
  /** Every free note of the user (an entry with a non-empty body, whatever its day), newest day first, then newest created. With a notebook id: only that notebook's. */
  listNotes(userId: string, notebookId?: string): Entry[];
  /** The entries filed on one collection, in their order on that page. */
  listCollection(userId: string, collectionId: string): Entry[];
  /** Like list for one horizon (day unless told otherwise), with the scan provenance of each entry (plus onPaper, like every entry). For the scan routes only: the snapshot never reaches the public API. */
  listScan(userId: string, range: DateRange, horizon?: EntryHorizon): ScanEntry[];
  /**
   * Records the paper line a scan last applied to an entry. Not an edit: updated_at and sync stay as they are.
   * Does nothing for an unknown entry.
   */
  setScanProvenance(userId: string, id: string, snapshot: ScanSnapshot): void;
  /** Marks an entry's title as read from paper (origin "scan"). Not an edit: updated_at and sync stay. */
  markScanOrigin(userId: string, id: string): void;
  /**
   * Files the entries of a scanned page: they get this page and the order of `ids` (the paper's line order), after the earlier pages and
   * before the later ones. Other entries of that page stay beside their old neighbours, entries not on paper stay at the end. Not an edit: no timestamps, no sync.
   */
  placeOnPaper(userId: string, slot: { date: string; horizon: EntryHorizon }, page: number, ids: readonly string[]): void;
  /** Forgets the paper line a scan or a "written" mark left on an entry, so it is not on paper any more. Not an edit: updated_at and sync stay. */
  clearScanProvenance(userId: string, id: string): void;
  /** Sets the indent (0 or 1) of an entry after a scan filed it. A 1 with no entry above stays 0. Not an edit: updated_at and sync stay (indent is local). */
  setIndent(userId: string, id: string, indent: 0 | 1): void;
  get(userId: string, id: string): Entry | undefined;
  /** The tags in use, with how many entries carry each and when one last changed. Newest use first, then by name. */
  listTags(userId: string): TagUse[];
  /**
   * A new entry goes to the end of its day, with sync "local". With input.id the client picked the id (an offline device):
   * a repeat of an id the user already has answers the stored entry and changes nothing. An id of another user throws EntryIdTaken.
   */
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

/** The entry columns, the scan provenance (read to derive onPaper, never sent), the tag list as JSON (in written order) and a flag for a stored photo (the bytes are never selected here). */
const COLUMNS =
  "id, date, horizon, time, type, title, body, note_kind, section, collection_id, important, sync, sync_error, position, paper_page, indent, created_at, updated_at, " +
  "scan_key, scan_type, scan_title, scan_tags, scan_time, scan_at, origin, " +
  "(SELECT json_group_array(tag) FROM (SELECT tag FROM entry_tags WHERE entry_id = entries.id ORDER BY position)) AS tags_json, " +
  "EXISTS (SELECT 1 FROM entry_photos WHERE entry_id = entries.id) AS has_photo";

/** The order inside one day: paper lines by page, then position; entries not on paper (no page) after all of them. */
const IN_DAY_ORDER = "(paper_page IS NULL), paper_page, position, created_at, id";
const DAY_ORDER = `ORDER BY ${IN_DAY_ORDER}`;

/** What the daily log shows: not a collection's entry and not a free note (a body). Notes and collections stand on their own pages, so this detaches old ones on read. */
const ON_THE_LOG = "collection_id IS NULL AND (body IS NULL OR body = '')";

/**
 * One page's ids in the scan's line order. An entry of the page the scan did not list (the OCR missed it) stays right after the
 * entry that sat above it before, so it does not jump to the end. One that sat above every listed entry goes first.
 */
function pageSequence(here: readonly string[], ids: readonly string[]): string[] {
  const listed = new Set(ids);
  const head: string[] = [];
  const after = new Map<string, string[]>();
  let anchor: string | null = null;
  for (const id of here) {
    if (listed.has(id)) anchor = id;
    else if (anchor === null) head.push(id);
    else after.set(anchor, [...(after.get(anchor) ?? []), id]);
  }
  return [...head, ...[...listed].flatMap((id) => [id, ...(after.get(id) ?? [])])];
}

/** The ids of a day in paper order after a scan: pages ascending, page `page` in the scan's line order, then the entries not on paper. */
function paperOrder(entries: readonly Entry[], page: number, ids: readonly string[]): string[] {
  const pages = [...new Set(entries.flatMap((entry) => (entry.page === null ? [] : [entry.page])))].sort((a, b) => a - b);
  const out: string[] = [];
  for (const number of pages) {
    const here = entries.filter((entry) => entry.page === number).map((entry) => entry.id);
    out.push(...(number === page ? pageSequence(here, ids) : here));
  }
  return [...out, ...entries.filter((entry) => entry.page === null).map((entry) => entry.id)];
}

/** A JSON list of text from the database, or an empty list when it is missing or not one. */
function parseTags(json: string | null): string[] {
  if (json === null) return [];
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

/** The snapshot of a row, or null when no scan has been applied to it. */
function toSnapshot(row: Row): ScanSnapshot | null {
  if (row.scan_key === null || row.scan_type === null || row.scan_title === null || row.scan_at === null) return null;
  return { key: row.scan_key, type: row.scan_type, title: row.scan_title, tags: parseTags(row.scan_tags), time: row.scan_time, at: Number(row.scan_at) };
}

/** The public entry of a row: no provenance, only the derived onPaper flag. */
function toEntry(row: Row): Entry {
  const entry = {
    id: row.id,
    date: row.date,
    horizon: row.horizon ?? "day",
    time: row.time,
    type: row.type,
    title: row.title,
    tags: parseTags(row.tags_json),
    body: row.body ?? null,
    noteKind: row.note_kind ?? null,
    section: row.section ?? null,
    collectionId: row.collection_id ?? null,
    important: Number(row.important) === 1,
    hasPhoto: Number(row.has_photo) === 1,
    sync: row.sync,
    syncError: row.sync_error,
    position: Number(row.position),
    page: row.paper_page === null || row.paper_page === undefined ? null : Number(row.paper_page),
    indent: Number(row.indent),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
  // An entry on a collection has no day page to copy onto paper, so it never waits to be written (back on the log it is judged again).
  const snapshot = toSnapshot(row);
  return { ...entry, onPaper: entry.collectionId !== null || onPaper(entry, snapshot), origin: originOf(row.origin, entry, snapshot) };
}

/**
 * One use per tag, ignoring case: the spelling of the newest use, how many entries carry it, and the newest change.
 * Newest first, then by name.
 */
function tagUses(rows: ReadonlyArray<{ tag: string; updated_at: number }>): TagUse[] {
  const byKey = new Map<string, TagUse>();
  for (const row of rows) {
    const key = row.tag.toLowerCase();
    const at = Number(row.updated_at);
    const seen = byKey.get(key);
    if (!seen) byKey.set(key, { tag: row.tag, count: 1, lastUsed: at });
    else if (at > seen.lastUsed) byKey.set(key, { tag: row.tag, count: seen.count + 1, lastUsed: at });
    else seen.count += 1;
  }
  return [...byKey.values()].sort((a, b) => b.lastUsed - a.lastUsed || a.tag.localeCompare(b.tag));
}

/** True when an entry belongs on the daily log (a free note does not). */
function isLogEntry(entry: Entry): boolean {
  return !entry.body;
}

/** Where an entry sits for ordering: all of a collection's entries form one group, any other entry belongs to its day (or month lane). */
type Group = { collectionId: string | null; date: string; horizon: EntryHorizon };

/** The SQL condition and its values for one group. */
function groupWhere(group: Group): { sql: string; args: Array<string> } {
  if (group.collectionId !== null) return { sql: "collection_id = ?", args: [group.collectionId] };
  return { sql: "collection_id IS NULL AND date = ? AND horizon = ?", args: [group.date, group.horizon] };
}

/** True when two entries sit in the same group. */
function sameGroup(a: Group, b: Group): boolean {
  if (a.collectionId !== null || b.collectionId !== null) return a.collectionId === b.collectionId;
  return a.date === b.date && a.horizon === b.horizon;
}

/** The entries table, always scoped to one user. */
export function createEntryStore(db: Db): EntryStore {
  /** Replaces the tags of an entry with this list, in order. */
  function writeTags(id: string, tags: readonly string[]): void {
    db.prepare("DELETE FROM entry_tags WHERE entry_id = ?").run(id);
    const insert = db.prepare("INSERT INTO entry_tags (entry_id, position, tag) VALUES (?, ?, ?)");
    tags.forEach((tag, position) => insert.run(id, position, tag));
  }

  function nextPosition(userId: string, group: Group): number {
    const where = groupWhere(group);
    const row = db.prepare(`SELECT MAX(position) AS top FROM entries WHERE user_id = ? AND ${where.sql}`).get(userId, ...where.args) as {
      top: number | null;
    };
    return row.top === null ? 0 : Number(row.top) + 1;
  }

  /** The user an entry id belongs to, or undefined when no entry has it. Ids are unique across users. */
  function owner(id: string): string | undefined {
    const row = db.prepare("SELECT user_id FROM entries WHERE id = ?").get(id) as { user_id: string } | undefined;
    return row?.user_id;
  }

  function get(userId: string, id: string): Entry | undefined {
    const row = db.prepare(`SELECT ${COLUMNS} FROM entries WHERE user_id = ? AND id = ?`).get(userId, id) as Row | undefined;
    return row ? toEntry(row) : undefined;
  }

  /** The ids of one group (a day, or a month's lane), in order. Month entries share the last day with that day's own entries, so the horizon is part of the group. */
  function groupIds(userId: string, group: Group): string[] {
    const where = groupWhere(group);
    const rows = db.prepare(`SELECT id FROM entries WHERE user_id = ? AND ${where.sql} ${DAY_ORDER}`).all(userId, ...where.args) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  function groupEntries(userId: string, group: Group): Entry[] {
    const where = groupWhere(group);
    return (db.prepare(`SELECT ${COLUMNS} FROM entries WHERE user_id = ? AND ${where.sql} ${DAY_ORDER}`).all(userId, ...where.args) as Row[]).map(toEntry);
  }

  /** Writes the order of a group as 0..n-1, and clears the indent of the first entry (nothing above it to nest under). */
  function renumber(userId: string, ids: string[]): void {
    const write = db.prepare("UPDATE entries SET position = ?, indent = CASE WHEN ? = 0 THEN 0 ELSE indent END WHERE user_id = ? AND id = ?");
    ids.forEach((id, index) => write.run(index, index, userId, id));
  }

  /** An indent of 1 only stands when an entry sits above in its group. */
  function settleIndent(userId: string, entry: Entry): void {
    if (entry.indent === 1 && groupIds(userId, entry).indexOf(entry.id) <= 0) {
      db.prepare("UPDATE entries SET indent = 0 WHERE user_id = ? AND id = ?").run(userId, entry.id);
    }
  }

  /** A free note (a body) with no notebook yet goes to the user's active one; a note already in one stays. Entries without a body are never filed. */
  function fileNoteInNotebook(userId: string, id: string, now: number): void {
    const note = db.prepare("SELECT 1 FROM entries WHERE user_id = ? AND id = ? AND notebook_id IS NULL AND body IS NOT NULL AND body <> ''").get(userId, id);
    if (!note) return;
    db.prepare("UPDATE entries SET notebook_id = ? WHERE user_id = ? AND id = ?").run(createNotebookStore(db).active(userId, now).id, userId, id);
  }

  return {
    list(userId, range) {
      const rows = db
        .prepare(`SELECT ${COLUMNS} FROM entries WHERE user_id = ? AND ${ON_THE_LOG} AND date >= ? AND date <= ? ORDER BY date, horizon, ${IN_DAY_ORDER}`)
        .all(userId, range.from, range.to) as Row[];
      return rows.map(toEntry);
    },

    listOpenBefore(userId, before) {
      const rows = db
        .prepare(
          `SELECT ${COLUMNS} FROM entries WHERE user_id = ? AND ${ON_THE_LOG} AND (horizon IS NULL OR horizon = 'day') AND type = 'task' AND date < ? ORDER BY date, ${IN_DAY_ORDER}`,
        )
        .all(userId, before) as Row[];
      return rows.map(toEntry);
    },

    listCollection(userId, collectionId) {
      return groupEntries(userId, { collectionId, date: "", horizon: "day" });
    },

    listNotes(userId, notebookId) {
      const scoped = notebookId === undefined ? "" : " AND notebook_id = ?";
      const rows = db
        .prepare(`SELECT ${COLUMNS} FROM entries WHERE user_id = ? AND body IS NOT NULL AND body <> ''${scoped} ORDER BY date DESC, created_at DESC, id DESC`)
        .all(...(notebookId === undefined ? [userId] : [userId, notebookId])) as Row[];
      return rows.map(toEntry);
    },

    get,

    listScan(userId, range, horizon = "day") {
      const rows = db
        .prepare(`SELECT ${COLUMNS} FROM entries WHERE user_id = ? AND ${ON_THE_LOG} AND horizon = ? AND date >= ? AND date <= ? ORDER BY date, ${IN_DAY_ORDER}`)
        .all(userId, horizon, range.from, range.to) as Row[];
      return rows.map((row) => ({ ...toEntry(row), scan: toSnapshot(row) }));
    },


    setScanProvenance(userId, id, snapshot) {
      db.prepare("UPDATE entries SET scan_key = ?, scan_type = ?, scan_title = ?, scan_tags = ?, scan_time = ?, scan_at = ? WHERE user_id = ? AND id = ?").run(
        snapshot.key,
        snapshot.type,
        snapshot.title,
        JSON.stringify(snapshot.tags),
        snapshot.time,
        snapshot.at,
        userId,
        id,
      );
    },

    markScanOrigin(userId, id) {
      db.prepare("UPDATE entries SET origin = 'scan' WHERE user_id = ? AND id = ?").run(userId, id);
    },

    setIndent(userId, id, indent) {
      db.prepare("UPDATE entries SET indent = ? WHERE user_id = ? AND id = ?").run(indent, userId, id);
      const entry = get(userId, id);
      if (entry) settleIndent(userId, entry);
    },

    clearScanProvenance(userId, id) {
      db.prepare("UPDATE entries SET scan_key = NULL, scan_type = NULL, scan_title = NULL, scan_tags = NULL, scan_time = NULL, scan_at = NULL WHERE user_id = ? AND id = ?").run(
        userId,
        id,
      );
    },

    listTags(userId) {
      const rows = db
        .prepare("SELECT t.tag AS tag, e.updated_at AS updated_at FROM entry_tags t JOIN entries e ON e.id = t.entry_id WHERE e.user_id = ?")
        .all(userId) as Array<{ tag: string; updated_at: number }>;
      return tagUses(rows);
    },

    create(userId, input, now) {
      const id = input.id ?? crypto.randomUUID();
      const existing = input.id ? owner(id) : undefined;
      if (existing === userId) return get(userId, id)!;
      if (existing !== undefined) throw new EntryIdTaken();
      const collectionId = input.collectionId ?? null;
      const horizon = collectionId ? "day" : (input.horizon ?? "day");
      const placed = settleHorizon(input, horizon);
      inTransaction(db, () => {
        db.prepare(
          "INSERT INTO entries (id, user_id, date, horizon, time, type, title, body, note_kind, section, collection_id, important, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).run(
          id,
          userId,
          placed.date,
          horizon,
          input.time,
          placed.type,
          input.title,
          input.body ?? null,
          input.noteKind ?? null,
          input.section ?? null,
          collectionId,
          input.important ? 1 : 0,
          nextPosition(userId, { collectionId, date: placed.date, horizon }),
          now,
          now,
        );
        writeTags(id, input.tags);
        fileNoteInNotebook(userId, id, now);
      });
      return get(userId, id)!;
    },

    update(userId, id, patch, now) {
      const current = get(userId, id);
      if (!current) return undefined;
      const collectionId = patch.collectionId === undefined ? current.collectionId : patch.collectionId;
      const horizon = collectionId ? "day" : (patch.horizon ?? current.horizon);
      const next = { ...settleHorizon({ ...current, ...patch }, horizon), horizon, collectionId };
      const stays = sameGroup(current, next);
      const position = stays ? current.position : nextPosition(userId, next);
      const indent = stays ? next.indent : (patch.indent ?? 0);
      inTransaction(db, () => {
        db.prepare(
          "UPDATE entries SET date = ?, horizon = ?, time = ?, type = ?, title = ?, body = ?, note_kind = ?, section = ?, collection_id = ?, important = ?, position = ?, paper_page = ?, indent = ?, updated_at = ? WHERE user_id = ? AND id = ?",
        ).run(
          next.date,
          next.horizon,
          next.time,
          next.type,
          next.title,
          next.body,
          next.noteKind ?? null,
          next.section ?? null,
          collectionId,
          next.important ? 1 : 0,
          position,
          // Another day is another sheet of paper: the entry is not on that page, so it goes to the end as unwritten.
          stays ? current.page : null,
          indent,
          now,
          userId,
          id,
        );
        if (patch.tags !== undefined) writeTags(id, patch.tags);
        fileNoteInNotebook(userId, id, now);
      });
      settleIndent(userId, get(userId, id)!);
      if (!stays) renumber(userId, groupIds(userId, current));
      return get(userId, id);
    },

    move(userId, id, direction) {
      const current = get(userId, id);
      if (!current) return undefined;
      const entries = groupEntries(userId, current);
      const from = entries.findIndex((entry) => entry.id === id);
      const to = direction === "up" ? from - 1 : from + 1;
      // An entry never swaps across a page boundary: the pages are fixed by the paper.
      if (to >= 0 && to < entries.length && entries[to].page === current.page) {
        const ids = entries.map((entry) => entry.id);
        [ids[from], ids[to]] = [ids[to], ids[from]];
        inTransaction(db, () => renumber(userId, ids));
      }
      return groupEntries(userId, current).filter(isLogEntry);
    },

    placeOnPaper(userId, slot, page, ids) {
      inTransaction(db, () => {
        const setPage = db.prepare("UPDATE entries SET paper_page = ? WHERE user_id = ? AND id = ?");
        ids.forEach((id) => setPage.run(page, userId, id));
        renumber(userId, paperOrder(groupEntries(userId, { ...slot, collectionId: null }), page, ids));
      });
    },

    remove(userId, id) {
      const current = get(userId, id);
      if (!current) return undefined;
      inTransaction(db, () => {
        db.prepare("DELETE FROM entries WHERE user_id = ? AND id = ?").run(userId, id);
        renumber(userId, groupIds(userId, current));
      });
      return groupEntries(userId, current).filter(isLogEntry);
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
