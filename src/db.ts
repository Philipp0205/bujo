import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type Db = DatabaseSync;

/** The traces table and its indexes: shared by the schema and by the rebuild of a table made before month-calendar existed. */
const TRACES_TABLE = `
CREATE TABLE IF NOT EXISTS entry_traces (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  horizon TEXT NOT NULL CHECK (horizon IN ('day', 'month-calendar', 'month-task', 'future')),
  kind TEXT NOT NULL CHECK (kind IN ('migrated', 'scheduled')),
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entry_traces_user_date ON entry_traces(user_id, date);
CREATE INDEX IF NOT EXISTS idx_entry_traces_entry ON entry_traces(entry_id);
`;

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
  created_at INTEGER NOT NULL,
  whats_new_seen TEXT
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
  type TEXT NOT NULL CHECK (type IN ('task', 'note', 'event', 'done', 'migrated', 'scheduled', 'dropped')),
  title TEXT NOT NULL,
  tag TEXT,
  sync TEXT NOT NULL DEFAULT 'local' CHECK (sync IN ('local', 'pending', 'synced', 'error')),
  position INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  remote_href TEXT,
  remote_uid TEXT,
  remote_etag TEXT,
  sync_error TEXT,
  body TEXT,
  indent INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_entries_user_date ON entries(user_id, date, position);

-- The scanned page photo of a free note, kept as a JPEG blob next to the note. Older databases get the table on open.
CREATE TABLE IF NOT EXISTS entry_photos (
  entry_id TEXT PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL,
  image BLOB NOT NULL,
  created_at INTEGER NOT NULL
);

-- The tags of an entry, in the order written. entries.tag is the old single tag: see moveSingleTags.
CREATE TABLE IF NOT EXISTS entry_tags (
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (entry_id, position)
);

-- What a move leaves on the old page (a ">" or "<" line). Never an entry: no UID, never synced. It goes with its entry.
${TRACES_TABLE}

-- Custom collections: named pages. An entry joins one through entries.collection_id. Local only, never synced.
CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  paper_page INTEGER
);
CREATE INDEX IF NOT EXISTS idx_collections_user ON collections(user_id, created_at);

-- One row per one-time data migration that has run.
CREATE TABLE IF NOT EXISTS migrations (
  name TEXT PRIMARY KEY
);
`;

const SINGLE_TAGS_MIGRATION = "entry-tags-v1";
const PAPER_PAGE_MIGRATION = "paper-page-v1";

/** Columns added after the first release of the entries table, with their SQL type. Older databases get them on open. */
const ENTRY_EXTRA_COLUMNS: ReadonlyArray<readonly [name: string, type: string]> = [
  ["remote_href", "TEXT"],
  ["remote_uid", "TEXT"],
  ["remote_etag", "TEXT"],
  ["sync_error", "TEXT"],
  ["body", "TEXT"],
  ["indent", "INTEGER NOT NULL DEFAULT 0"],
  // The handwritten * before the bullet (0 or 1). Maps to PRIORITY:1 on the sync target.
  ["important", "INTEGER NOT NULL DEFAULT 0"],
  // day, month-calendar, month-task or future (see src/log/horizon.ts). Older rows are day entries.
  ["horizon", "TEXT NOT NULL DEFAULT 'day'"],
  // Scan provenance: the paper line last applied to the entry (see src/log/scan/). Database only, never in the Entry API.
  ["scan_key", "TEXT"],
  ["scan_type", "TEXT"],
  ["scan_title", "TEXT"],
  ["scan_tag", "TEXT"],
  ["scan_tags", "TEXT"],
  ["scan_time", "TEXT"],
  ["scan_at", "INTEGER"],
  // The physical page (1, 2, ...) of the day the entry was read from by a scan. Null means not on paper (written in the app): it sorts after every paper line.
  ["paper_page", "INTEGER"],
  // The custom collection the entry is filed on (collections.id). Null means the daily log.
  ["collection_id", "TEXT"],
];

/** Columns added after the first release of the users table. whats_new_seen is the newest what's-new entry id the account has seen. */
const USER_EXTRA_COLUMNS: ReadonlyArray<readonly [name: string, type: string]> = [
  ["whats_new_seen", "TEXT"],
];

/** Columns added after the first release of the collections table. paper_page is the notebook page the collection is written on (null: none). */
const COLLECTION_EXTRA_COLUMNS: ReadonlyArray<readonly [name: string, type: string]> = [
  ["paper_page", "INTEGER"],
];

/** Adds the columns a table made before they existed lacks. Safe to run on every open. */
function addMissingColumns(
  db: Db,
  table: "users" | "entries" | "collections",
  columns: ReadonlyArray<readonly [name: string, type: string]>,
): void {
  const have = (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name);
  for (const [column, type] of columns) {
    if (!have.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

/** Brings tables of older databases up to date: the sync columns, body, indent and scan provenance of entries, the seen id of users, the tag list, the trace horizons. */
function migrate(db: Db): void {
  addMissingColumns(db, "entries", ENTRY_EXTRA_COLUMNS);
  addMissingColumns(db, "users", USER_EXTRA_COLUMNS);
  addMissingColumns(db, "collections", COLLECTION_EXTRA_COLUMNS);
  moveSingleTags(db);
  placeScannedOnFirstPage(db);
  allowCalendarTraces(db);
  allowDroppedType(db);
}

/**
 * Entries a scan touched before pages existed sit on page 1: the paper they came from was the only page. Runs once. The flag is
 * set in the same transaction, so an entry that later leaves paper (no scan_key, or null page by design) is never put back.
 */
function placeScannedOnFirstPage(db: Db): void {
  if (db.prepare("SELECT 1 FROM migrations WHERE name = ?").get(PAPER_PAGE_MIGRATION)) return;
  inTransaction(db, () => {
    db.exec("UPDATE entries SET paper_page = 1 WHERE scan_key IS NOT NULL AND paper_page IS NULL");
    db.prepare("INSERT INTO migrations (name) VALUES (?)").run(PAPER_PAGE_MIGRATION);
  });
}

/**
 * An entries table made before the dropped type refuses it in its CHECK, so it is rebuilt once with the new list, from its own
 * definition (every column it has stays). Foreign keys are off meanwhile, or dropping the old table would cascade to the tags,
 * traces and photos of its entries. Rows are kept. A table with no CHECK on the type is left alone.
 */
function allowDroppedType(db: Db): void {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'entries'").get() as { sql: string } | undefined;
  if (!row || row.sql.includes("'dropped'") || !row.sql.includes("'scheduled')")) return;
  const next = row.sql.replace(/^CREATE TABLE\s+"?entries"?/i, "CREATE TABLE entries_new").replace("'scheduled')", "'scheduled', 'dropped')");
  db.exec("PRAGMA foreign_keys = OFF");
  try {
    inTransaction(db, () => {
      db.exec(next);
      db.exec("INSERT INTO entries_new SELECT * FROM entries");
      db.exec("DROP TABLE entries");
      db.exec("ALTER TABLE entries_new RENAME TO entries");
      db.exec("CREATE INDEX IF NOT EXISTS idx_entries_user_date ON entries(user_id, date, position)");
    });
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}

/** A traces table made before month-calendar existed refuses that horizon in its CHECK, so it is rebuilt once with the new list. Rows are kept. */
function allowCalendarTraces(db: Db): void {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'entry_traces'").get() as { sql: string } | undefined;
  if (!row || row.sql.includes("month-calendar")) return;
  inTransaction(db, () => {
    db.exec("DROP INDEX IF EXISTS idx_entry_traces_user_date; DROP INDEX IF EXISTS idx_entry_traces_entry;");
    db.exec("ALTER TABLE entry_traces RENAME TO entry_traces_old");
    db.exec(TRACES_TABLE);
    db.exec("INSERT INTO entry_traces SELECT id, user_id, entry_id, date, horizon, kind, title, created_at FROM entry_traces_old");
    db.exec("DROP TABLE entry_traces_old");
  });
}

/**
 * Entries once held one tag in entries.tag (and scan_tag for the last scanned line). They hold a list now: entry_tags, and
 * scan_tags as a JSON array. This copies the old values over once. The flag is set in the same transaction as the copy, so a
 * tag cleared later is never copied back. The old columns stay in the table but are never read or written again.
 */
function moveSingleTags(db: Db): void {
  const done = db.prepare("SELECT 1 FROM migrations WHERE name = ?").get(SINGLE_TAGS_MIGRATION);
  if (done) return;
  inTransaction(db, () => {
    db.exec(`
      INSERT OR IGNORE INTO entry_tags (entry_id, position, tag)
        SELECT id, 0, tag FROM entries WHERE tag IS NOT NULL AND tag <> '';
      UPDATE entries SET scan_tags = CASE WHEN scan_tag IS NULL OR scan_tag = '' THEN '[]' ELSE json_array(scan_tag) END
        WHERE scan_key IS NOT NULL AND scan_tags IS NULL;
    `);
    db.prepare("INSERT INTO migrations (name) VALUES (?)").run(SINGLE_TAGS_MIGRATION);
  });
}

/** Opens (and creates) the database. ":memory:" for tests. A file path gets its folder made and WAL on. */
export function openDb(file: string): Db {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON");
  if (file !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/** Runs fn inside one transaction: everything it writes is kept, or nothing is. Inside a transaction already, fn joins it. */
export function inTransaction<T>(db: Db, fn: () => T): T {
  if (db.isTransaction) return fn();
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
