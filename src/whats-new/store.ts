import type { Db } from "../db.ts";

/** The newest what's-new entry id the account has seen. Null or empty means nothing yet. */
export function getSeen(db: Db, userId: string): string | null {
  const row = db.prepare("SELECT whats_new_seen AS seen FROM users WHERE id = ?").get(userId) as { seen: string | null } | undefined;
  return row?.seen || null;
}

/** Stores the seen id on the account. Used on close, and at sign-up so a new account skips the history. */
export function setSeen(db: Db, userId: string, id: string): void {
  db.prepare("UPDATE users SET whats_new_seen = ? WHERE id = ?").run(id, userId);
}
