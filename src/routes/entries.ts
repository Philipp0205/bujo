import { HttpError, readJson, SECURITY_HEADERS, sendJson } from "../app-kit/http.ts";
import { createPhotoStore } from "../log/photo-store.ts";
import { createEntryStore, type EntryStore } from "../log/store.ts";
import { checkEntryPatch, checkNewEntry, checkRange } from "../log/validation.ts";
import type { Checked, Entry } from "../log/types.ts";
import { readPhoto } from "../scan/photo.ts";
import { touchesMapping } from "../sync/service.ts";
import { SYNC_MESSAGES } from "../sync/strings.ts";
import { isRead, requireSession, type RouteContext } from "./context.ts";

/** Room for a free note: BODY_MAX characters can take up to four bytes each in JSON. */
const ENTRY_BODY_MAX = 256 * 1024;

/** A failed check is a 400 with the message. */
function valid<T>(checked: Checked<T>): T {
  if (!checked.ok) throw new HttpError(400, checked.error);
  return checked.value;
}

function methodNotAllowed(allow: string): never {
  throw new HttpError(405, `method not allowed (use ${allow})`);
}

/**
 * /api/entries, the rapid log. Browser sessions only, like /api/backlog.
 *   GET   /api/entries?from=&to=   entries of a date range, by date then position
 *   GET   /api/entries?kind=notes  every free note (a non-empty body) of any day, newest first
 *   POST  /api/entries             a new entry, at the end of its day
 *   PATCH /api/entries/:id         change date, type, title, tag, time, indent (0 or 1) or body (the markdown of a free note, null when none)
 *   DELETE /api/entries/:id        remove the entry from the log (local only, nothing is deleted on Nextcloud), answers its day
 *   POST  /api/entries/:id/move    { direction: "up" | "down" } swap places with the neighbour in the day, answers the day
 *   POST  /api/entries/:id/sync    push again an entry whose sync failed
 *   GET   /api/entries/:id/photo   the scan photo of a free note (JPEG), 404 when it has none
 *   POST  /api/entries/:id/photo   store the scan photo of a note (a JPEG as the raw body), replacing an earlier one
 * A task entry answers with sync "pending" and is pushed to Nextcloud after the answer is sent.
 */
export async function handleEntryRoutes(ctx: RouteContext): Promise<boolean> {
  const { req, res, url, method, pathname, accounts, who } = ctx;
  if (pathname !== "/api/entries" && !pathname.startsWith("/api/entries/")) return false;
  const session = requireSession(who);
  const store = createEntryStore(accounts.db);
  const userId = session.user.id;

  if (pathname === "/api/entries") {
    if (isRead(method)) {
      if (url.searchParams.has("kind")) return listNotes(ctx, store, userId);
      const range = valid(checkRange(url.searchParams.get("from"), url.searchParams.get("to")));
      sendJson(res, 200, { entries: store.list(userId, range) });
      return true;
    }
    if (method !== "POST") methodNotAllowed("GET or POST");
    const input = valid(checkNewEntry(await readJson(req, { max: ENTRY_BODY_MAX })));
    const created = store.create(userId, input, accounts.now());
    sendJson(res, 201, { entry: ctx.sync ? ctx.sync.enqueue(userId, created) : created });
    return true;
  }

  const match = /^\/api\/entries\/([^/]+)(\/sync|\/photo|\/move)?$/.exec(pathname);
  if (!match) throw new HttpError(404, "not found");
  const id = decodeId(match[1]);
  if (match[2] === "/photo") return handlePhoto(ctx, userId, id);
  if (match[2] === "/move") return handleMove(ctx, store, userId, id);
  if (match[2]) {
    if (method !== "POST") methodNotAllowed("POST");
    sendJson(res, 200, { entry: retrySync(ctx, store, userId, id) });
    return true;
  }
  if (method === "DELETE") {
    const day = store.remove(userId, id);
    if (!day) throw new HttpError(404, "unknown entry");
    sendJson(res, 200, { entries: day });
    return true;
  }
  if (method !== "PATCH") methodNotAllowed("PATCH or DELETE");
  const patch = valid(checkEntryPatch(await readJson(req, { max: ENTRY_BODY_MAX })));
  const entry = store.update(userId, id, patch, accounts.now());
  if (!entry) throw new HttpError(404, "unknown entry");
  sendJson(res, 200, { entry: ctx.sync && touchesMapping(patch, entry) ? ctx.sync.enqueue(userId, entry) : entry });
  return true;
}

/** GET ?kind=notes lists every free note of the user, newest first, for the Notes screen. Any other kind is a 400. */
function listNotes(ctx: RouteContext, store: EntryStore, userId: string): boolean {
  if (ctx.url.searchParams.get("kind") !== "notes") throw new HttpError(400, "kind must be notes");
  sendJson(ctx.res, 200, { entries: store.listNotes(userId) });
  return true;
}

/** POST { direction } swaps the entry with its neighbour in the day and answers the day in its new order. Never starts a push. */
async function handleMove(ctx: RouteContext, store: EntryStore, userId: string, id: string): Promise<boolean> {
  if (ctx.method !== "POST") methodNotAllowed("POST");
  const body = await readJson(ctx.req);
  if (body.direction !== "up" && body.direction !== "down") throw new HttpError(400, "direction must be up or down");
  const day = store.move(userId, id, body.direction);
  if (!day) throw new HttpError(404, "unknown entry");
  sendJson(ctx.res, 200, { entries: day });
  return true;
}


/** Pushes an entry again. Only an entry in the error state can be retried. */
function retrySync(ctx: RouteContext, store: EntryStore, userId: string, id: string): Entry {
  const entry = store.get(userId, id);
  if (!entry) throw new HttpError(404, "unknown entry");
  if (!ctx.sync) throw new HttpError(503, SYNC_MESSAGES.notSetUp);
  if (entry.sync !== "error") throw new HttpError(409, SYNC_MESSAGES.retryNotNeeded);
  return ctx.sync.enqueue(userId, entry);
}

/** True when the bytes start like a JPEG file (the client sends JPEG only, so anything else is not a photo). */
function looksLikeJpeg(image: Buffer): boolean {
  return image.length > 3 && image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff;
}

/** GET sends the stored photo of the owner's note, POST stores one (the page photo of a scan). 404 when there is none or it is not theirs. */
async function handlePhoto(ctx: RouteContext, userId: string, id: string): Promise<boolean> {
  const { req, res, method, accounts } = ctx;
  const entries = createEntryStore(accounts.db);
  const photos = createPhotoStore(accounts.db);
  if (isRead(method)) {
    const photo = photos.get(userId, id);
    if (!photo) throw new HttpError(404, "no photo");
    res.writeHead(200, { ...SECURITY_HEADERS, "content-type": photo.contentType, "content-length": photo.image.length });
    res.end(method === "HEAD" ? undefined : photo.image);
    return true;
  }
  if (method !== "POST") methodNotAllowed("GET or POST");
  if (!entries.get(userId, id)) throw new HttpError(404, "unknown entry");
  const { image, contentType } = await readPhoto(req, ["image/jpeg"]);
  if (!looksLikeJpeg(image)) throw new HttpError(415, "the photo is not a JPEG file");
  photos.put(userId, id, { image, contentType }, accounts.now());
  sendJson(ctx.res, 200, { entry: entries.get(userId, id) });
  return true;
}

function decodeId(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new HttpError(404, "unknown entry");
  }
}
