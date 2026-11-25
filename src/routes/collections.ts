import { HttpError, readJson, sendJson } from "../app-kit/http.ts";
import { checkCollectionName, checkPaperPage, createCollectionStore } from "../log/collections.ts";
import { isRead, requireSession, type RouteContext } from "./context.ts";
import type { Collection } from "../log/types.ts";

/**
 * /api/collections, the named pages of the log. Browser sessions only. Local to bujo: nothing here reaches Nextcloud.
 *   GET  /api/collections   every collection with its entry count and paperPage (the notebook page, or null): { collections }, index order:
 *                           those with a paperPage first by number, then the rest in the order they were made
 *   POST /api/collections   { name, paperPage? } a new collection (201). A name the user already has answers that collection with 200 (paperPage ignored then)
 * The entries of a page are GET /api/entries?collection=<id>. An entry joins one with collectionId on POST or PATCH /api/entries.
 *   PATCH  /api/collections/:id   { name? , paperPage? } at least one: { collection }. paperPage is null or a whole number 1..9999 (null clears it).
 *                                 400 bad value or empty body, 404 unknown, 409 another page has that name (ignoring case)
 *   DELETE /api/collections/:id   removes the page. Its entries stay on the log with collectionId cleared: { ok: true }. 404 unknown
 */
export async function handleCollectionRoutes(ctx: RouteContext): Promise<boolean> {
  const one = /^\/api\/collections\/([^/]+)$/.exec(ctx.pathname);
  if (one) return handleOne(ctx, decodeURIComponent(one[1]!));
  if (ctx.pathname !== "/api/collections") return false;
  const userId = requireSession(ctx.who).user.id;
  const store = createCollectionStore(ctx.accounts.db);
  if (isRead(ctx.method)) {
    sendJson(ctx.res, 200, { collections: store.list(userId) });
    return true;
  }
  if (ctx.method !== "POST") throw new HttpError(405, "method not allowed (use GET or POST)");
  const body = await readJson(ctx.req);
  const name = checkCollectionName(body.name);
  if (!name.ok) throw new HttpError(400, name.error);
  const page = "paperPage" in body ? checkPaperPage(body.paperPage) : { ok: true as const, value: null };
  if (!page.ok) throw new HttpError(400, page.error);
  const before = store.list(userId).length;
  let collection = store.create(userId, name.value, ctx.accounts.now());
  const made = store.list(userId).length > before;
  if (made && page.value !== null) collection = store.setPaperPage(userId, collection.id, page.value)!;
  sendJson(ctx.res, made ? 201 : 200, { collection });
  return true;
}

/** PATCH renames and/or sets the page number of one collection, DELETE removes it and frees its entries. Local only: no sync target is touched. */
async function handleOne(ctx: RouteContext, id: string): Promise<boolean> {
  const userId = requireSession(ctx.who).user.id;
  const store = createCollectionStore(ctx.accounts.db);
  if (ctx.method === "DELETE") {
    if (!store.remove(userId, id)) throw new HttpError(404, "unknown collection");
    sendJson(ctx.res, 200, { ok: true });
    return true;
  }
  if (ctx.method !== "PATCH") throw new HttpError(405, "method not allowed (use PATCH or DELETE)");
  const body = await readJson(ctx.req);
  const hasName = "name" in body;
  const hasPage = "paperPage" in body;
  if (!hasName && !hasPage) throw new HttpError(400, "send name, paperPage or both");
  const name = hasName ? checkCollectionName(body.name) : undefined;
  if (name && !name.ok) throw new HttpError(400, name.error);
  const page = hasPage ? checkPaperPage(body.paperPage) : undefined;
  if (page && !page.ok) throw new HttpError(400, page.error);
  let result: Collection | "taken" | undefined = store.get(userId, id);
  if (name?.ok) result = store.rename(userId, id, name.value);
  if (!result) throw new HttpError(404, "unknown collection");
  if (result === "taken") throw new HttpError(409, "another collection already has that name");
  if (page?.ok) result = store.setPaperPage(userId, id, page.value)!;
  sendJson(ctx.res, 200, { collection: result });
  return true;
}
