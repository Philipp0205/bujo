import type { Db } from "../db.ts";
import { createCollectionStore } from "./collections.ts";
import { createPaperPageStore } from "./paper-pages.ts";

/** What a listed notebook page is: a day, a month log, a future log or a collection. */
export type IndexKind = "day" | "month" | "future" | "collection";

/** One known notebook page. `ref` is a date, a month (YYYY-MM) or a collection id. `page` is the physical page of a day, else 1. `label` is a collection's name. */
export type IndexPage = { number: number; kind: IndexKind; ref: string; page: number; label?: string };

const KIND_ORDER: readonly IndexKind[] = ["day", "month", "future", "collection"];

/** Ascending by number, then by kind (day, month, future, collection), then ref, then physical page. */
function byPosition(a: IndexPage, b: IndexPage): number {
  return a.number - b.number || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.ref.localeCompare(b.ref) || a.page - b.page;
}

/** Every known paper page of the user: stored scan numbers plus collections that have a page number. Gaps are fine, nothing is invented. With a notebook id: only that notebook's pages. */
export function listIndex(db: Db, userId: string, notebookId?: string): IndexPage[] {
  const scanned: IndexPage[] = createPaperPageStore(db)
    .list(userId, notebookId)
    .map(({ kind, ref, page, number }) => ({ number, kind, ref, page }));
  const collections: IndexPage[] = createCollectionStore(db)
    .list(userId, notebookId)
    .flatMap((collection) =>
      collection.paperPage === null ? [] : [{ number: collection.paperPage, kind: "collection" as const, ref: collection.id, page: 1, label: collection.name }],
    );
  return [...scanned, ...collections].sort(byPosition);
}
