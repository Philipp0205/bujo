import { HttpError, readJson, SECURITY_HEADERS, sendJson } from "../app-kit/http.ts";
import { updateEntry } from "../log/move.ts";
import { markWritten } from "../log/paper.ts";
import { createPhotoStore } from "../log/photo-store.ts";
import { createEntryStore, EntryIdTaken, type EntryStore } from "../log/store.ts";
import { createTraceStore } from "../log/trace.ts";
import { checkEntryPatch, checkNewEntry, checkRange } from "../log/validation.ts";
import type { Checked, Entry, NewEntry } from "../log/types.ts";
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
 *   GET   /api/entries?from=&to=&onPaper=0   only the entries of the range that are not on paper yet, never a done one (any other onPaper value is a 400)
 *   GET   /api/entries?from=&to=&traces=1   also { traces } for the range: what moves left on the old pages ({ id, entryId, date, horizon, kind, title }), local notes that are never synced
 *   GET   /api/entries?kind=notes  every free note (a non-empty body) of any day, newest first
 *   GET   /api/tags                the tags of the log in use: [{ tag, count, lastUsed }], newest use first
 *   POST  /api/entries             a new entry, at the end of its day. An optional client id (a UUID) makes it idempotent: a repeat answers 200 with the stored entry, an id of another user is a 409
 *   PATCH /api/entries/:id         change date, horizon, type, title, tags (a list, empty when none), time, indent (0 or 1) or body (the markdown of a free note, null when none). Add trace ("migrated" or "scheduled") to leave a ">" or "<" trace on the old page when the edit moves the entry to another page: same id, same UID
 *   DELETE /api/entries/:id        remove the entry from the log (local only, nothing is deleted on Nextcloud), answers its day
 *   POST  /api/entries/:id/move    { direction: "up" | "down" } swap places with the neighbour in the day, answers the day
 *   POST  /api/entries/:id/sync    push again an entry whose sync failed
 *   POST  /api/entries/:id/written mark the entry as written on paper (stamps its current fields, not an edit), answers { entry } with onPaper true
 *   GET   /api/entries/:id/photo   the scan photo of a free note (JPEG), 404 when it has none
 *   POST  /api/entries/:id/photo   store the scan photo of a note (a JPEG as the raw body), replacing an earlier one
 * A task entry answers with sync "pending" and is pushed to Nextcloud after the answer is sent.
 */
export async function handleEntryRoutes(ctx: RouteContext): Promise<boolean> {
  const { req, res, url, method, pathname, accounts, who } = ctx;
  if (pathname === "/api/tags") return listTags(ctx);
  if (pathname !== "/api/entries" && !pathname.startsWith("/api/entries/")) return false;
  const session = requireSession(who);
  const store = createEntryStore(accounts.db);
  const userId = session.user.id;

  if (pathname === "/api/entries") {
    if (isRead(method)) {
      if (url.searchParams.has("kind")) return listNotes(ctx, store, userId);
      const range = valid(checkRange(url.searchParams.get("from"), url.searchParams.get("to")));
      const entries = store.list(userId, range);
      const shown = onPaperFilter(url.searchParams.get("onPaper")) ? entries.filter(isNotOnPaperCandidate) : entries;
      const traces = url.searchParams.get("traces") === "1" ? { traces: createTraceStore(accounts.db).list(userId, range) } : {};
      sendJson(res, 200, { entries: shown, ...traces });
      return true;
    }
    if (method !== "POST") methodNotAllowed("GET or POST");
    const input = valid(checkNewEntry(await readJson(req, { max: ENTRY_BODY_MAX })));
    return createEntry(ctx, store, userId, input);
  }

  const match = /^\/api\/entries\/([^/]+)(\/sync|\/photo|\/move|\/written)?$/.exec(pathname);
  if (!match) throw new HttpError(404, "not found");
  const id = decodeId(match[1]);
  if (match[2] === "/photo") return handlePhoto(ctx, userId, id);
  if (match[2] === "/move") return handleMove(ctx, store, userId, id);
  if (match[2] === "/written") return handleWritten(ctx, store, userId, id);
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
  const entry = updateEntry(accounts.db, userId, id, patch, accounts.now());
  if (!entry) throw new HttpError(404, "unknown entry");
  const unflag = patch.important === false;
  sendJson(res, 200, { entry: ctx.sync && touchesMapping(patch, entry) ? ctx.sync.enqueue(userId, entry, { unflag }) : entry });
  return true;
}

/**
 * POST a new entry. A client id the user already has is a replay of an offline save: 200 with the stored entry, nothing
 * inserted and no second push. An id of another user is a 409. A new entry answers 201 and is pushed after the answer.
 */
function createEntry(ctx: RouteContext, store: EntryStore, userId: string, input: NewEntry): boolean {
  const replay = input.id ? store.get(userId, input.id) : undefined;
  if (replay) {
    sendJson(ctx.res, 200, { entry: replay });
    return true;
  }
  let created: Entry;
  try {
    created = store.create(userId, input, ctx.accounts.now());
  } catch (error) {
    if (error instanceof EntryIdTaken) throw new HttpError(409, "that id is already in use");
    throw error;
  }
  sendJson(ctx.res, 201, { entry: ctx.sync ? ctx.sync.enqueue(userId, created) : created });
  return true;
}

/** GET /api/tags answers the tags the log uses, for the autocomplete. Rapid-log tags only, not the backlog's. */
function listTags(ctx: RouteContext): boolean {
  const session = requireSession(ctx.who);
  if (!isRead(ctx.method)) methodNotAllowed("GET");
  sendJson(ctx.res, 200, { tags: createEntryStore(ctx.accounts.db).listTags(session.user.id) });
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

/** ?onPaper=0 asks for the entries not on paper yet. Absent means all; any other value is a 400. */
function onPaperFilter(value: string | null): boolean {
  if (value === null) return false;
  if (value !== "0") throw new HttpError(400, "onPaper must be 0");
  return true;
}

/** An entry the "not on paper" list asks about: not on paper yet, and not done (a done x needs no copy onto paper). */
function isNotOnPaperCandidate(entry: Entry): boolean {
  return !entry.onPaper && entry.type !== "done";
}

/** POST marks the entry as written on paper: stamps its current fields as the paper state. Not an edit, no push. */
async function handleWritten(ctx: RouteContext, store: EntryStore, userId: string, id: string): Promise<boolean> {
  if (ctx.method !== "POST") methodNotAllowed("POST");
  const entry = markWritten(store, userId, id, ctx.accounts.now());
  if (!entry) throw new HttpError(404, "unknown entry");
  sendJson(ctx.res, 200, { entry });
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
