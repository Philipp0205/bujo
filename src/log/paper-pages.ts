import type { Db } from "../db.ts";
import { createNotebookStore } from "./notebooks.ts";

/** The highest notebook page number. Same limit as a collection's. */
export const PAGE_NUMBER_MAX = 9999;

/** What a notebook page number belongs to: a day (one physical page of it), a month log or a future log. */
export type PaperKind = "day" | "month" | "future";

/** One stored notebook page number. `ref` is a date (day), or a month YYYY-MM (month, future). `page` is the physical page of a day, else 1. */
export type PaperPage = { kind: PaperKind; ref: string; page: number; number: number };

/** The notebook page numbers a scan read and the person confirmed. Always scoped to one user. */
export type PaperPageStore = {
  /** Saves the number for (kind, ref, page) in the user's active notebook. The same key again replaces the number and files it in the active notebook. */
  save(userId: string, kind: PaperKind, ref: string, page: number, number: number, now: number): void;
  /** Every stored number of the user, unsorted. With a notebook id: only that notebook's. */
  list(userId: string, notebookId?: string): PaperPage[];
};

/** A whole number from 1 to 9999, else null. Used for what the OCR service says, where anything odd just means no number. */
export function asPageNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= PAGE_NUMBER_MAX ? value : null;
}

/** The paper_pages table. */
export function createPaperPageStore(db: Db): PaperPageStore {
  return {
    save(userId, kind, ref, page, number, now) {
      const notebookId = createNotebookStore(db).active(userId, now).id;
      db.prepare(
        "INSERT INTO paper_pages (user_id, kind, ref, page, number, notebook_id) VALUES (?, ?, ?, ?, ?, ?) " +
          "ON CONFLICT (user_id, kind, ref, page) DO UPDATE SET number = excluded.number, notebook_id = excluded.notebook_id",
      ).run(userId, kind, ref, page, number, notebookId);
    },

    list(userId, notebookId) {
      const scoped = notebookId === undefined ? "" : " AND notebook_id = ?";
      const rows = db.prepare(`SELECT kind, ref, page, number FROM paper_pages WHERE user_id = ?${scoped}`).all(...(notebookId === undefined ? [userId] : [userId, notebookId])) as PaperPage[];
      return rows.map((row) => ({ kind: row.kind, ref: row.ref, page: Number(row.page), number: Number(row.number) }));
    },
  };
}
