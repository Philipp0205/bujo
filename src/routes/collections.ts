import { HttpError, readJson, sendJson } from "../app-kit/http.ts";
import { checkCollectionName, createCollectionStore } from "../log/collections.ts";
import { isRead, requireSession, type RouteContext } from "./context.ts";

/**
 * /api/collections, the named pages of the log. Browser sessions only. Local to bujo: nothing here reaches Nextcloud.
 *   GET  /api/collections   every collection with its entry count: { collections }, in the order they were made
 *   POST /api/collections   { name } a new collection (201). A name the user already has answers that collection with 200
 * The entries of a page are GET /api/entries?collection=<id>. An entry joins one with collectionId on POST or PATCH /api/entries.
 *   PATCH  /api/collections/:id   { name } renames it: { collection }. 400 bad name, 404 unknown, 409 another page has that name (ignoring case)
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
  const name = checkCollectionName((await readJson(ctx.req)).name);
  if (!name.ok) throw new HttpError(400, name.error);
  const before = store.list(userId).length;
  const collection = store.create(userId, name.value, ctx.accounts.now());
  sendJson(ctx.res, store.list(userId).length > before ? 201 : 200, { collection });
  return true;
}

/** PATCH renames one collection, DELETE removes it and frees its entries. Local only: no sync target is touched. */
async function handleOne(ctx: RouteContext, id: string): Promise<boolean> {
  const userId = requireSession(ctx.who).user.id;
  const store = createCollectionStore(ctx.accounts.db);
  if (ctx.method === "DELETE") {
    if (!store.remove(userId, id)) throw new HttpError(404, "unknown collection");
    sendJson(ctx.res, 200, { ok: true });
    return true;
  }
  if (ctx.method !== "PATCH") throw new HttpError(405, "method not allowed (use PATCH or DELETE)");
  const name = checkCollectionName((await readJson(ctx.req)).name);
  if (!name.ok) throw new HttpError(400, name.error);
  const result = store.rename(userId, id, name.value);
  if (!result) throw new HttpError(404, "unknown collection");
  if (result === "taken") throw new HttpError(409, "another collection already has that name");
  sendJson(ctx.res, 200, { collection: result });
  return true;
}
