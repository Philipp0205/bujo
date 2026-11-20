import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type Db = DatabaseSync;

/**
 * Accounts, sessions, mail links and agent tokens. Every secret is stored as a sha256 hash.
 *
 * bujo is a single-user app: the trigger below refuses a second user row, so two requests
 * (or two processes) that both pass the "no user yet" check cannot both create an account.
 * Lift the trigger when real multi-user support is added.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  email_verified_at INTEGER,
  recovery_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_recovery_hash ON users(recovery_hash);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_verified_email ON users(email)
  WHERE email IS NOT NULL AND email_verified_at IS NOT NULL;
CREATE TRIGGER IF NOT EXISTS users_single_user BEFORE INSERT ON users
  WHEN (SELECT COUNT(*) FROM users) >= 1
BEGIN
  SELECT RAISE(ABORT, 'single user: an account already exists');
END;

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS auth_links (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_links_user ON auth_links(user_id, kind);

CREATE TABLE IF NOT EXISTS agent_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('read', 'write')),
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_agent_tokens_user ON agent_tokens(user_id);

CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  time TEXT,
  type TEXT NOT NULL CHECK (type IN ('task', 'note', 'event', 'done', 'migrated', 'scheduled')),
  title TEXT NOT NULL,
  tag TEXT,
  sync TEXT NOT NULL DEFAULT 'local' CHECK (sync IN ('local', 'pending', 'synced', 'error')),
  position INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  remote_href TEXT,
  remote_uid TEXT,
  remote_etag TEXT,
  sync_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_entries_user_date ON entries(user_id, date, position);
`;

/** Columns added after the first release of the entries table. Older databases get them on open. */
const ENTRY_SYNC_COLUMNS = ["remote_href", "remote_uid", "remote_etag", "sync_error"] as const;

/** Adds the remote sync columns to an entries table made before they existed. Safe to run on every open. */
function migrateEntries(db: Db): void {
  const have = (db.prepare("PRAGMA table_info(entries)").all() as Array<{ name: string }>).map((column) => column.name);
  for (const column of ENTRY_SYNC_COLUMNS) {
    if (!have.includes(column)) db.exec(`ALTER TABLE entries ADD COLUMN ${column} TEXT`);
  }
}

/** Opens (and creates) the database. ":memory:" for tests. A file path gets its folder made and WAL on. */
export function openDb(file: string): Db {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON");
  if (file !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  db.exec(SCHEMA);
  migrateEntries(db);
  return db;
}

/** Runs fn inside one transaction: everything it writes is kept, or nothing is. */
export function inTransaction<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function countUsers(db: Db): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
  return Number(row.n);
}
