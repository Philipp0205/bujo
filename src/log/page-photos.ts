import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Db } from "../db.ts";
import { createNotebookStore } from "./notebooks.ts";

/** What a page photo shows: a day, a month log, a future log or a collection. */
export type PhotoKind = "day" | "month" | "future" | "collection";

/** The page a photo shows. `ref` is a date, a month or a collection id. `page` is the physical page of a day, else 1. */
export type PhotoPlace = { kind: PhotoKind; ref: string; page: number };

/** One kept photo of a page, as the notebook detail lists it. */
export type PagePhoto = { id: string; createdAt: number };

type Row = { id: string; kind: PhotoKind; ref: string; page: number; created_at: number };

/** The page photos of one user: rows in page_photos, JPEG files in a folder. Every photo of a page is kept, newest first. */
export type PagePhotoStore = {
  /** Writes the file and the row for a new photo of the place. Undefined when the place is unknown (no such collection). */
  add(userId: string, place: PhotoPlace, image: Buffer, now: number): string | undefined;
  /** The JPEG bytes of the user's photo, undefined when it is not theirs or its file is gone. */
  read(userId: string, id: string): Buffer | undefined;
};

/** The key a page is looked up by: kind, ref and physical page. */
export function photoKey(place: PhotoPlace): string {
  return `${place.kind}|${place.ref}|${place.page}`;
}

/** Where a new photo is filed: the notebook and number of the stored page, or the active notebook with no number yet. */
function filing(db: Db, userId: string, place: PhotoPlace, now: number): { notebookId: string | null; number: number | null; collectionId: string | null } | undefined {
  if (place.kind === "collection") {
    const row = db.prepare("SELECT notebook_id, paper_page FROM collections WHERE user_id = ? AND id = ?").get(userId, place.ref) as { notebook_id: string | null; paper_page: number | null } | undefined;
    return row ? { notebookId: row.notebook_id ?? null, number: row.paper_page === null ? null : Number(row.paper_page), collectionId: place.ref } : undefined;
  }
  const stored = db.prepare("SELECT notebook_id, number FROM paper_pages WHERE user_id = ? AND kind = ? AND ref = ? AND page = ?").get(userId, place.kind, place.ref, place.page) as
    | { notebook_id: string | null; number: number }
    | undefined;
  if (stored) return { notebookId: stored.notebook_id ?? null, number: Number(stored.number), collectionId: null };
  return { notebookId: createNotebookStore(db).active(userId, now).id, number: null, collectionId: null };
}

/** The page_photos table, with the JPEG files in `dir` (created on first use). A file of a deleted row stays on disk but is never served. */
export function createPagePhotoStore(db: Db, dir: string): PagePhotoStore {
  const fileOf = (id: string): string => path.join(dir, `${id}.jpg`);
  return {
    add(userId, place, image, now) {
      const where = filing(db, userId, place, now);
      if (!where) return undefined;
      const id = crypto.randomUUID();
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fileOf(id), image);
      db.prepare(
        "INSERT INTO page_photos (id, user_id, notebook_id, number, kind, ref, page, collection_id, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(id, userId, where.notebookId, where.number, place.kind, place.ref, place.page, where.collectionId, image.length, now);
      return id;
    },

    read(userId, id) {
      const row = db.prepare("SELECT id FROM page_photos WHERE user_id = ? AND id = ?").get(userId, id);
      if (!row) return undefined;
      try {
        return fs.readFileSync(fileOf(id));
      } catch {
        return undefined;
      }
    },
  };
}

/** Every photo of the user, newest first, grouped by `photoKey`. One query for a whole notebook detail. Needs no folder: it only reads rows. */
export function photosByPage(db: Db, userId: string): Map<string, PagePhoto[]> {
  const rows = db.prepare("SELECT id, kind, ref, page, created_at FROM page_photos WHERE user_id = ? ORDER BY created_at DESC, rowid DESC").all(userId) as Row[];
  const groups = new Map<string, PagePhoto[]>();
  for (const row of rows) {
    const key = photoKey({ kind: row.kind, ref: row.ref, page: Number(row.page) });
    groups.set(key, [...(groups.get(key) ?? []), { id: row.id, createdAt: Number(row.created_at) }]);
  }
  return groups;
}
