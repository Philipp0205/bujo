import { inTransaction, type Db } from "../db.ts";
import type { Checked } from "./types.ts";
import { DEFAULT_PAGE_COUNT, FIRST_NOTEBOOK_NAME, insertOpenNotebook, todayOf } from "./notebook-first.ts";

/** The longest notebook name, in characters. */
export const NOTEBOOK_NAME_MAX = 60;

/** The most pages a notebook can have. Same limit as a page number. */
export const NOTEBOOK_PAGES_MAX = 9999;

/** One physical notebook. `endedOn` is null while it is the active one (the one new scans go to). */
export type Notebook = { id: string; name: string; pageCount: number; startedOn: string; endedOn: string | null; active: boolean; createdAt: number };

type Row = { id: string; name: string; page_count: number; started_on: string; ended_on: string | null; created_at: number };

/** The physical notebooks of one user. Local only: nothing here ever reaches a sync target. */
export type NotebookStore = {
  /** Every notebook of the user, newest first (the active one first). A user with none gets "Notebook 1" first. */
  list(userId: string, now: number): Notebook[];
  get(userId: string, id: string): Notebook | undefined;
  /** The one open notebook (made on the spot when the user has none). New scans, collections and free notes go to it. */
  active(userId: string, now: number): Notebook;
  /** Ends the open notebook today and opens a new one today, in one transaction. */
  startNew(userId: string, input: { name: string; pageCount: number }, now: number): Notebook;
  /** Renames and/or resizes a notebook. Undefined for an unknown id; "too-small" when pageCount is below its highest scanned page. */
  update(userId: string, id: string, patch: { name?: string; pageCount?: number }): Notebook | "too-small" | undefined;
  /** The highest page number saved in a notebook, a scanned page or a collection (0 when none). */
  highestPage(userId: string, id: string): number;
};

/** Checks a notebook name: one line of text, trimmed, within the limit. */
export function checkNotebookName(value: unknown): Checked<string> {
  if (typeof value !== "string") return { ok: false, error: "name must be text" };
  const name = value.trim().replace(/\s+/g, " ");
  if (name === "") return { ok: false, error: "name is required" };
  if (name.length > NOTEBOOK_NAME_MAX) return { ok: false, error: `name is too long (at most ${NOTEBOOK_NAME_MAX} characters)` };
  if (/[\u0000-\u001f\u007f]/.test(name)) return { ok: false, error: "name must be one line of plain text" };
  return { ok: true, value: name };
}

/** Checks a page count: a whole number from 1 to 9999. Text is refused, even digits. */
export function checkPageCount(value: unknown): Checked<number> {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > NOTEBOOK_PAGES_MAX) {
    return { ok: false, error: `pageCount must be a whole number from 1 to ${NOTEBOOK_PAGES_MAX}` };
  }
  return { ok: true, value };
}

function toNotebook(row: Row): Notebook {
  return {
    id: row.id,
    name: row.name,
    pageCount: Number(row.page_count),
    startedOn: row.started_on,
    endedOn: row.ended_on ?? null,
    active: row.ended_on === null || row.ended_on === undefined,
    createdAt: Number(row.created_at),
  };
}

/** The notebooks table, always scoped to one user. */
export function createNotebookStore(db: Db): NotebookStore {
  const select = "SELECT id, name, page_count, started_on, ended_on, created_at FROM notebooks WHERE user_id = ?";

  function get(userId: string, id: string): Notebook | undefined {
    const row = db.prepare(`${select} AND id = ?`).get(userId, id) as Row | undefined;
    return row ? toNotebook(row) : undefined;
  }

  function open(userId: string): Row | undefined {
    return db.prepare(`${select} AND ended_on IS NULL`).get(userId) as Row | undefined;
  }

  function active(userId: string, now: number): Notebook {
    const row = open(userId);
    if (row) return toNotebook(row);
    const id = insertOpenNotebook(db, userId, FIRST_NOTEBOOK_NAME, DEFAULT_PAGE_COUNT, todayOf(now), now);
    return get(userId, id)!;
  }

  function highestPage(userId: string, id: string): number {
    const row = db
      .prepare("SELECT MAX(n) AS top FROM (SELECT number AS n FROM paper_pages WHERE user_id = ? AND notebook_id = ? UNION ALL SELECT paper_page AS n FROM collections WHERE user_id = ? AND notebook_id = ?)")
      .get(userId, id, userId, id) as { top: number | null };
    return Number(row.top ?? 0);
  }

  return {
    list(userId, now) {
      active(userId, now);
      return (db.prepare(`${select} ORDER BY (ended_on IS NULL) DESC, started_on DESC, created_at DESC, id`).all(userId) as Row[]).map(toNotebook);
    },

    get,

    active,

    startNew(userId, input, now) {
      return inTransaction(db, () => {
        const today = todayOf(now);
        active(userId, now);
        db.prepare("UPDATE notebooks SET ended_on = ? WHERE user_id = ? AND ended_on IS NULL").run(today, userId);
        return get(userId, insertOpenNotebook(db, userId, input.name, input.pageCount, today, now))!;
      });
    },

    update(userId, id, patch) {
      const current = get(userId, id);
      if (!current) return undefined;
      const pageCount = patch.pageCount ?? current.pageCount;
      if (pageCount < highestPage(userId, id)) return "too-small";
      db.prepare("UPDATE notebooks SET name = ?, page_count = ? WHERE user_id = ? AND id = ?").run(patch.name ?? current.name, pageCount, userId, id);
      return get(userId, id)!;
    },

    highestPage,
  };
}
