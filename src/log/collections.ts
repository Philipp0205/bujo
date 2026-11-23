import crypto from "node:crypto";
import type { Db } from "../db.ts";
import type { Checked, Collection } from "./types.ts";

/** The longest collection name, in characters. */
export const COLLECTION_NAME_MAX = 60;

type Row = { id: string; name: string; created_at: number; count: number };

/** The named pages of one user. Local only: nothing here ever reaches a sync target. */
export type CollectionStore = {
  /** Every collection of the user with how many entries it holds, in the order they were made. */
  list(userId: string): Collection[];
  get(userId: string, id: string): Collection | undefined;
  /** A new, empty collection. A name the user already has (ignoring case) answers that collection and makes no second one. */
  create(userId: string, name: string, now: number): Collection;
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

function toCollection(row: Row): Collection {
  return { id: row.id, name: row.name, count: Number(row.count), createdAt: Number(row.created_at) };
}

/** The collections table, always scoped to one user. */
export function createCollectionStore(db: Db): CollectionStore {
  const select = "SELECT c.id, c.name, c.created_at, (SELECT COUNT(*) FROM entries e WHERE e.collection_id = c.id) AS count FROM collections c WHERE c.user_id = ?";

  function get(userId: string, id: string): Collection | undefined {
    const row = db.prepare(`${select} AND c.id = ?`).get(userId, id) as Row | undefined;
    return row ? toCollection(row) : undefined;
  }

  return {
    list(userId) {
      return (db.prepare(`${select} ORDER BY c.created_at, c.id`).all(userId) as Row[]).map(toCollection);
    },

    get,

    create(userId, name, now) {
      const same = db.prepare(`${select} AND lower(c.name) = lower(?)`).get(userId, name) as Row | undefined;
      if (same) return toCollection(same);
      const id = crypto.randomUUID();
      db.prepare("INSERT INTO collections (id, user_id, name, created_at) VALUES (?, ?, ?, ?)").run(id, userId, name, now);
      return get(userId, id)!;
    },
  };
}
