import { HttpError, readJson, sendJson } from "../app-kit/http.ts";
import { createCollectionStore } from "../log/collections.ts";
import { checkNotebookName, checkPageCount, createNotebookStore, type Notebook } from "../log/notebooks.ts";
import { pageStatus } from "../log/notebook-pages.ts";
import { listIndex } from "../log/page-index.ts";
import { createEntryStore } from "../log/store.ts";
import { isRead, requireSession, type RouteContext } from "./context.ts";

/**
 * /api/notebooks, the physical notebooks of the user. Browser sessions only. Local to bujo: nothing here reaches Nextcloud.
 * A notebook is { id, name, pageCount, startedOn, endedOn, active, createdAt }. endedOn is null while it is the active one: the one
 * new scans, collections and free notes go to. A user with no notebook gets "Notebook 1" the first time it is needed.
 *   GET   /api/notebooks       { notebooks }: every notebook, the active one first, then newest start first; each also has scannedCount (its pages
 *                              with a scan or a collection, within pageCount)
 *   POST  /api/notebooks       { name, pageCount } starts a new notebook (201): the active one gets today as its end date and the new one
 *                              starts today and is active, in one transaction. name is one line (at most 60 characters), pageCount a whole number 1..9999
 *   GET   /api/notebooks/:id   { notebook, pages, collections, notes }: the same pages as GET /api/index (ascending by number) but only
 *                              those of this notebook, its collections (with entry counts) and its free notes (newest first). 404 unknown
 *   PATCH /api/notebooks/:id   { name?, pageCount? } at least one: { notebook }. 400 bad value, empty body, or a pageCount below the highest
 *                              page number of that notebook (a scanned page or a collection number). 404 unknown
 * GET /api/index is unchanged: it lists the pages of every notebook of the user, not only the active one.
 */
export async function handleNotebookRoutes(ctx: RouteContext): Promise<boolean> {
  const one = /^\/api\/notebooks\/([^/]+)$/.exec(ctx.pathname);
  if (one) return handleOne(ctx, decodeURIComponent(one[1]!));
  if (ctx.pathname !== "/api/notebooks") return false;
  const userId = requireSession(ctx.who).user.id;
  const store = createNotebookStore(ctx.accounts.db);
  if (isRead(ctx.method)) {
    sendJson(ctx.res, 200, { notebooks: withScannedCounts(ctx, userId, store.list(userId, ctx.accounts.now())) });
    return true;
  }
  if (ctx.method !== "POST") throw new HttpError(405, "method not allowed (use GET or POST)");
  const body = await readJson(ctx.req);
  const name = checkNotebookName(body.name);
  if (!name.ok) throw new HttpError(400, name.error);
  const pageCount = checkPageCount(body.pageCount);
  if (!pageCount.ok) throw new HttpError(400, pageCount.error);
  sendJson(ctx.res, 201, { notebook: store.startNew(userId, { name: name.value, pageCount: pageCount.value }, ctx.accounts.now()) });
  return true;
}

/** The list rows with how many of their pages are scanned (the same count the detail shows), so the list can say "x of N scanned". */
function withScannedCounts(ctx: RouteContext, userId: string, notebooks: Notebook[]): Array<Notebook & { scannedCount: number }> {
  return notebooks.map((notebook) => {
    const status = pageStatus(listIndex(ctx.accounts.db, userId, notebook.id), notebook.pageCount);
    return { ...notebook, scannedCount: status.filter((entry) => entry.scanned).length };
  });
}

/** GET answers the detail of one notebook, PATCH renames and/or resizes it. */
async function handleOne(ctx: RouteContext, id: string): Promise<boolean> {
  const userId = requireSession(ctx.who).user.id;
  const store = createNotebookStore(ctx.accounts.db);
  if (isRead(ctx.method)) return sendDetail(ctx, userId, id);
  if (ctx.method !== "PATCH") throw new HttpError(405, "method not allowed (use GET or PATCH)");
  const body = await readJson(ctx.req);
  const hasName = "name" in body;
  const hasCount = "pageCount" in body;
  if (!hasName && !hasCount) throw new HttpError(400, "send name, pageCount or both");
  const name = hasName ? checkNotebookName(body.name) : undefined;
  if (name && !name.ok) throw new HttpError(400, name.error);
  const pageCount = hasCount ? checkPageCount(body.pageCount) : undefined;
  if (pageCount && !pageCount.ok) throw new HttpError(400, pageCount.error);
  const result = store.update(userId, id, { name: name?.ok ? name.value : undefined, pageCount: pageCount?.ok ? pageCount.value : undefined });
  if (!result) throw new HttpError(404, "unknown notebook");
  if (result === "too-small") throw new HttpError(400, `pageCount is below page ${store.highestPage(userId, id)}, the highest page number in this notebook`);
  sendJson(ctx.res, 200, { notebook: result });
  return true;
}

/** The detail of one notebook: its numbered pages, collections and free notes. */
function sendDetail(ctx: RouteContext, userId: string, id: string): boolean {
  const db = ctx.accounts.db;
  const notebook = createNotebookStore(db).get(userId, id);
  if (!notebook) throw new HttpError(404, "unknown notebook");
  sendJson(ctx.res, 200, {
    notebook,
    pages: listIndex(db, userId, id),
    collections: createCollectionStore(db).list(userId, id),
    notes: createEntryStore(db).listNotes(userId, id),
  });
  return true;
}
