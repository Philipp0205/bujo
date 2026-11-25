import crypto from "node:crypto";
import { inTransaction, type Db } from "../db.ts";
import type { Checked, Collection } from "./types.ts";

/** The longest collection name, in characters. */
export const COLLECTION_NAME_MAX = 60;

type Row = { id: string; name: string; created_at: number; count: number; paper_page: number | null };

/** The highest notebook page number a collection can have. */
export const PAPER_PAGE_MAX = 9999;

/** The named pages of one user. Local only: nothing here ever reaches a sync target. */
export type CollectionStore = {
  /** Every collection of the user with how many entries it holds, like an index: those with a page number first by number, then the rest in the order they were made. */
  list(userId: string): Collection[];
  get(userId: string, id: string): Collection | undefined;
  /** A new, empty collection without a page number. A name the user already has (ignoring case) answers that collection and makes no second one. */
  create(userId: string, name: string, now: number): Collection;
  /** Sets or (with null) clears the notebook page number. Undefined for an unknown id. */
  setPaperPage(userId: string, id: string, page: number | null): Collection | undefined;
  /** Renames a collection. Undefined for an unknown id; "taken" when a different collection has that name (ignoring case). */
  rename(userId: string, id: string, name: string): Collection | "taken" | undefined;
  /**
   * Deletes a collection. Its entries stay: each goes back to the end of its own day on the daily log (date and the rest untouched).
   * False for an unknown id. One transaction, local only.
   */
  remove(userId: string, id: string): boolean;
};

/** Checks a name: one line of text, trimmed, within the limit. */
export function checkCollectionName(value: unknown): Checked<string> {
  if (typeof value !== "string") return { ok: false, error: "name must be text" };
  const name = value.trim().replace(/\s+/g, " ");
  if (name === "") return { ok: false, error: "name is required" };
  if (name.length > COLLECTION_NAME_MAX) return { ok: false, error: `name is too long (at most ${COLLECTION_NAME_MAX} characters)` };
  if (/[\u0000-\u001f\u007f]/.test(name)) return { ok: false, error: "name must be one line of plain text" };
  return { ok: true, value: name };
}

/** Checks a notebook page number: null (none) or a whole number from 1 to 9999. Text is refused, even digits. */
export function checkPaperPage(value: unknown): Checked<number | null> {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > PAPER_PAGE_MAX) {
    return { ok: false, error: `paperPage must be null or a whole number from 1 to ${PAPER_PAGE_MAX}` };
  }
  return { ok: true, value };
}

function toCollection(row: Row): Collection {
  const page = row.paper_page;
  return { id: row.id, name: row.name, count: Number(row.count), createdAt: Number(row.created_at), paperPage: page === null || page === undefined ? null : Number(page) };
}

/** Clears collection_id on every entry of a page, in page order, each at the end of its own day group so positions never collide. */
function unfileEntries(db: Db, userId: string, id: string): void {
  const rows = db.prepare("SELECT id, date, horizon FROM entries WHERE user_id = ? AND collection_id = ? ORDER BY position, created_at, id").all(userId, id) as Array<{ id: string; date: string; horizon: string | null }>;
  const top = db.prepare("SELECT MAX(position) AS top FROM entries WHERE user_id = ? AND collection_id IS NULL AND date = ? AND horizon IS ?");
  const write = db.prepare("UPDATE entries SET collection_id = NULL, position = ?, indent = 0 WHERE user_id = ? AND id = ?");
  for (const row of rows) {
    const last = (top.get(userId, row.date, row.horizon) as { top: number | null }).top;
    write.run(last === null ? 0 : Number(last) + 1, userId, row.id);
  }
}

/** The collections table, always scoped to one user. */
export function createCollectionStore(db: Db): CollectionStore {
  const select = "SELECT c.id, c.name, c.created_at, c.paper_page, (SELECT COUNT(*) FROM entries e WHERE e.collection_id = c.id) AS count FROM collections c WHERE c.user_id = ?";

  function get(userId: string, id: string): Collection | undefined {
    const row = db.prepare(`${select} AND c.id = ?`).get(userId, id) as Row | undefined;
    return row ? toCollection(row) : undefined;
  }

  return {
    list(userId) {
      return (db.prepare(`${select} ORDER BY c.paper_page IS NULL, c.paper_page, c.created_at, c.id`).all(userId) as Row[]).map(toCollection);
    },

    get,

    create(userId, name, now) {
      const same = db.prepare(`${select} AND lower(c.name) = lower(?)`).get(userId, name) as Row | undefined;
      if (same) return toCollection(same);
      const id = crypto.randomUUID();
      db.prepare("INSERT INTO collections (id, user_id, name, created_at) VALUES (?, ?, ?, ?)").run(id, userId, name, now);
      return get(userId, id)!;
    },

    setPaperPage(userId, id, page) {
      if (!get(userId, id)) return undefined;
      db.prepare("UPDATE collections SET paper_page = ? WHERE user_id = ? AND id = ?").run(page, userId, id);
      return get(userId, id)!;
    },

    rename(userId, id, name) {
      if (!get(userId, id)) return undefined;
      const same = db.prepare("SELECT id FROM collections WHERE user_id = ? AND lower(name) = lower(?) AND id <> ?").get(userId, name, id);
      if (same) return "taken";
      db.prepare("UPDATE collections SET name = ? WHERE user_id = ? AND id = ?").run(name, userId, id);
      return get(userId, id)!;
    },

    remove(userId, id) {
      if (!get(userId, id)) return false;
      inTransaction(db, () => {
        unfileEntries(db, userId, id);
        db.prepare("DELETE FROM collections WHERE user_id = ? AND id = ?").run(userId, id);
      });
      return true;
    },
  };
}
