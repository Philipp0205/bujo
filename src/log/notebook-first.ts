import crypto from "node:crypto";
import { isoDate } from "../app-kit/time.ts";
import { TIME_ZONE } from "../scan/draft.ts";
import type { Db } from "../db.ts";

/** The name of the notebook made when a user has none yet (also the one existing scans migrate into). */
export const FIRST_NOTEBOOK_NAME = "Notebook 1";

/** The page count of a notebook nothing says more about. */
export const DEFAULT_PAGE_COUNT = 100;

/** Today in the app's time zone, as YYYY-MM-DD. */
export function todayOf(now: number): string {
  return isoDate(now, TIME_ZONE);
}

/** The page count for a first notebook whose highest known page number is `highest` (0 when none): the default, or that number rounded up to ten. */
export function firstPageCount(highest: number): number {
  return Math.max(DEFAULT_PAGE_COUNT, Math.ceil(highest / 10) * 10);
}

/** Inserts an open (no end date) notebook and answers its id. A leaf of the db layer: it needs nothing but the handle, so db.ts can use it too. */
export function insertOpenNotebook(db: Db, userId: string, name: string, pageCount: number, startedOn: string, now: number): string {
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO notebooks (id, user_id, name, page_count, started_on, ended_on, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)").run(
    id,
    userId,
    name,
    pageCount,
    startedOn,
    now,
  );
  return id;
}
