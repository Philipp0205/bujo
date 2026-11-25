import type { Db } from "../db.ts";

/** The highest notebook page number. Same limit as a collection's. */
export const PAGE_NUMBER_MAX = 9999;

/** What a notebook page number belongs to: a day (one physical page of it), a month log or a future log. */
export type PaperKind = "day" | "month" | "future";

/** One stored notebook page number. `ref` is a date (day), or a month YYYY-MM (month, future). `page` is the physical page of a day, else 1. */
export type PaperPage = { kind: PaperKind; ref: string; page: number; number: number };

/** The notebook page numbers a scan read and the person confirmed. Always scoped to one user. */
export type PaperPageStore = {
  /** Saves the number for (kind, ref, page). The same key again replaces the number. */
  save(userId: string, kind: PaperKind, ref: string, page: number, number: number): void;
  /** Every stored number of the user, unsorted. */
  list(userId: string): PaperPage[];
};

/** A whole number from 1 to 9999, else null. Used for what the OCR service says, where anything odd just means no number. */
export function asPageNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= PAGE_NUMBER_MAX ? value : null;
}

/** The paper_pages table. */
export function createPaperPageStore(db: Db): PaperPageStore {
  return {
    save(userId, kind, ref, page, number) {
      db.prepare(
        "INSERT INTO paper_pages (user_id, kind, ref, page, number) VALUES (?, ?, ?, ?, ?) " +
          "ON CONFLICT (user_id, kind, ref, page) DO UPDATE SET number = excluded.number",
      ).run(userId, kind, ref, page, number);
    },

    list(userId) {
      const rows = db.prepare("SELECT kind, ref, page, number FROM paper_pages WHERE user_id = ?").all(userId) as PaperPage[];
      return rows.map((row) => ({ kind: row.kind, ref: row.ref, page: Number(row.page), number: Number(row.number) }));
    },
  };
}
