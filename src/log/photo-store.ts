import type { Db } from "../db.ts";

export type StoredPhoto = { image: Buffer; contentType: string };

export type PhotoStore = {
  /** Keeps the photo of an entry of this user, replacing an earlier one. False when the user has no such entry. */
  put(userId: string, entryId: string, photo: StoredPhoto, now: number): boolean;
  /** The photo of an entry of this user, or undefined when the entry has none or belongs to someone else. */
  get(userId: string, entryId: string): StoredPhoto | undefined;
};

type PhotoRow = { image: Uint8Array; content_type: string };

/** The photos of free notes, as blobs in the same database file (and so on the same volume) as the notes. */
export function createPhotoStore(db: Db): PhotoStore {
  return {
    put(userId, entryId, photo, now) {
      const owned = db.prepare("SELECT 1 AS ok FROM entries WHERE user_id = ? AND id = ?").get(userId, entryId);
      if (!owned) return false;
      db.prepare(
        "INSERT INTO entry_photos (entry_id, content_type, image, created_at) VALUES (?, ?, ?, ?) " +
          "ON CONFLICT(entry_id) DO UPDATE SET content_type = excluded.content_type, image = excluded.image, created_at = excluded.created_at",
      ).run(entryId, photo.contentType, photo.image, now);
      return true;
    },

    get(userId, entryId) {
      const row = db
        .prepare("SELECT p.image, p.content_type FROM entry_photos p JOIN entries e ON e.id = p.entry_id WHERE e.user_id = ? AND p.entry_id = ?")
        .get(userId, entryId) as PhotoRow | undefined;
      return row ? { image: Buffer.from(row.image), contentType: row.content_type } : undefined;
    },
  };
}
