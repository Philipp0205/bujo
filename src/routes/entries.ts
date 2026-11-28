import { HttpError, readJson, SECURITY_HEADERS, sendJson } from "../app-kit/http.ts";
import { createCollectionStore } from "../log/collections.ts";
import { isEntryHorizon } from "../log/horizon.ts";
import { checkFiling, commitFiling } from "../log/into-note.ts";
import { updateEntry } from "../log/move.ts";
import { markWritten } from "../log/paper.ts";
import { createPhotoStore } from "../log/photo-store.ts";
import { createEntryStore, EntryIdTaken, type EntryStore } from "../log/store.ts";
import { createTraceStore } from "../log/trace.ts";
import { checkEntryPatch, checkNewEntry, checkRange, isValidDate } from "../log/validation.ts";
import { ENTRY_HORIZONS, type Checked, type Entry, type NewEntry } from "../log/types.ts";
import { looksLikeJpeg, readPhoto } from "../scan/photo.ts";
import { touchesMapping } from "../sync/service.ts";
import { SYNC_MESSAGES } from "../sync/strings.ts";
import { isRead, requireSession, type RouteContext } from "./context.ts";

/** Room for a free note: BODY_MAX characters can take up to four bytes each in JSON. */
const ENTRY_BODY_MAX = 256 * 1024;

/** The most ids one reorder names: a day of a log is never this long. */
const ORDER_MAX = 500;

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
 *   GET   /api/entries?from=&to=   entries of a date range, by date then position. Not collection entries and not free notes (a body): those stand on their own pages, not on a day
 *   GET   /api/entries?from=&to=&onPaper=0   only the entries of the range that are not on paper yet, never a done one (any other onPaper value is a 400)
 *   GET   /api/entries?from=&to=&traces=1   also { traces } for the range: what moves left on the old pages ({ id, entryId, date, horizon, kind, title }), local notes that are never synced
 *   GET   /api/entries?openBefore=<day>  every open task of the daily log from a day before that day, any age, oldest first (no range cap; for the migration review)
 *   GET   /api/entries?kind=notes  every free note (a non-empty body) of any day, newest first
 *   GET   /api/entries?collection=<id>  { collection, entries }: the entries filed on one collection, in page order (they are never in the day lists)
 *   GET   /api/tags                the tags of the log in use: [{ tag, count, lastUsed }], newest use first
 *   POST  /api/entries             a new entry, at the end of its day. An optional client id (a UUID) makes it idempotent: a repeat answers 200 with the stored entry, an id of another user is a 409
 *   PATCH /api/entries/:id         change date, horizon, type, title, tags (a list, empty when none), time, indent (0 or 1), body (the markdown of a free note, null when none) or collectionId (a collection id files the entry on that page, null puts it back on the daily log). Add trace ("migrated" or "scheduled") to leave a ">" or "<" trace on the old page when the edit moves the entry to another page: same id, same UID
 *   DELETE /api/entries/:id        remove the entry (a note with its photo too) from bujo (local only, nothing is deleted on Nextcloud), answers its day
 *   POST  /api/entries/:id/move    { direction: "up" | "down" } swap places with the neighbour in the day, answers the day
 *   POST  /api/entries/order       { date, horizon, ids } put those entries of one day (or month lane) in that order, in the places they held (drag and drop), answers the day. 400 for a bad body or an order across a paper page boundary, 404 for an id that is not in that day. Local only
 *   POST  /api/entries/:id/sync    push again an entry whose sync failed
 *   POST  /api/entries/:id/into-note { noteId } add a task's title as a new last line of a free-form note (a bullet when the note is a list) and take the task off the log. A task on Nextcloud is pushed as dropped (CANCELLED) first, never deleted there. Answers { note, entries } (the task's old day). 400 for a non-task or a target without a body or a body that would pass BODY_MAX, 404 for an unknown entry or note, 502 when the cancel push fails
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
      if (url.searchParams.has("collection")) return listCollection(ctx, store, userId);
      if (url.searchParams.has("openBefore")) return listOpenBefore(ctx, store, userId);
      const range = valid(checkRange(url.searchParams.get("from"), url.searchParams.get("to")));
      const entries = store.list(userId, range);
      const shown = onPaperFilter(url.searchParams.get("onPaper")) ? entries.filter(isNotOnPaperCandidate) : entries;
      const traces = url.searchParams.get("traces") === "1" ? { traces: createTraceStore(accounts.db).list(userId, range) } : {};
      sendJson(res, 200, { entries: shown, ...traces });
      return true;
    }
    if (method !== "POST") methodNotAllowed("GET or POST");
    const input = valid(checkNewEntry(await readJson(req, { max: ENTRY_BODY_MAX })));
    requireCollection(ctx, userId, input.collectionId);
    return createEntry(ctx, store, userId, input);
  }

  if (pathname === "/api/entries/order") return handleOrder(ctx, store, userId);

  const match = /^\/api\/entries\/([^/]+)(\/sync|\/photo|\/move|\/written|\/into-note)?$/.exec(pathname);
  if (!match) throw new HttpError(404, "not found");
  const id = decodeId(match[1]);
  if (match[2] === "/into-note") return handleIntoNote(ctx, store, userId, id);
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
  requireCollection(ctx, userId, patch.collectionId);
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

/**
 * POST { noteId } files a task into a free-form note as a new last line and takes it off the log (local delete, the VTODO is never deleted).
 * A task that is on Nextcloud is pushed as dropped first (STATUS CANCELLED), so the list shows it handled. If that push fails, nothing is filed.
 * Answers { note, entries } with the note and what is left of the task's old day (or page).
 */
async function handleIntoNote(ctx: RouteContext, store: EntryStore, userId: string, id: string): Promise<boolean> {
  if (ctx.method !== "POST") methodNotAllowed("POST");
  const noteId = (await readJson(ctx.req)).noteId;
  if (typeof noteId !== "string" || !noteId) throw new HttpError(400, "noteId must be a note id");
  const filing = checkFiling(store, userId, id, noteId);
  if (!filing.ok) throw new HttpError(filing.status, filing.error);
  const refusal = await settleRemote(ctx, store, userId, filing.entry);
  if (refusal) throw new HttpError(502, refusal);
  const done = commitFiling(ctx.accounts.db, userId, filing, ctx.accounts.now());
  sendJson(ctx.res, 200, { note: done.note, entries: done.day });
  return true;
}

/**
 * Makes the remote object of a task match "handled" before the entry leaves the log. A task on Nextcloud (or one still being pushed)
 * is set to dropped and pushed, so its VTODO ends CANCELLED; a done task is already COMPLETED. Resolves with a message when the push failed.
 */
async function settleRemote(ctx: RouteContext, store: EntryStore, userId: string, entry: Entry): Promise<string | null> {
  const sync = ctx.sync;
  if (!sync || !(store.getRemote(userId, entry.id) || entry.sync === "pending")) return null;
  if (entry.type !== "done") {
    const dropped = updateEntry(ctx.accounts.db, userId, entry.id, { type: "dropped" }, ctx.accounts.now());
    if (dropped) sync.enqueue(userId, dropped);
  }
  await sync.idle();
  const after = store.get(userId, entry.id);
  return after?.sync === "error" ? (after.syncError ?? SYNC_MESSAGES.unexpected) : null;
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

/** GET ?openBefore=<day> lists every open task of the daily log from a day before that day, however old (the migration review). A bad day is a 400. */
function listOpenBefore(ctx: RouteContext, store: EntryStore, userId: string): boolean {
  const day = ctx.url.searchParams.get("openBefore");
  if (!isValidDate(day)) throw new HttpError(400, "openBefore must be a date like 2026-11-20");
  sendJson(ctx.res, 200, { entries: store.listOpenBefore(userId, day) });
  return true;
}

/** GET ?collection=<id> lists the entries filed on one of the user's collections, in page order. An unknown collection is a 404. */
function listCollection(ctx: RouteContext, store: EntryStore, userId: string): boolean {
  const id = ctx.url.searchParams.get("collection") ?? "";
  requireCollection(ctx, userId, id);
  sendJson(ctx.res, 200, { collection: createCollectionStore(ctx.accounts.db).get(userId, id), entries: store.listCollection(userId, id) });
  return true;
}

/** A collectionId a request names must be one of the user's collections (null and absent are fine: the daily log). */
function requireCollection(ctx: RouteContext, userId: string, id: string | null | undefined): void {
  if (id && !createCollectionStore(ctx.accounts.db).get(userId, id)) throw new HttpError(404, "unknown collection");
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

/**
 * POST { date, horizon, ids } puts those entries of the day (or month lane) in that order, in the places they held, and answers the day
 * in its new order. A repeat is safe (same order, same answer). 400 for a bad body or an order that crosses a paper page boundary,
 * 404 when an id is not in that day. Local only: never starts a push.
 */
async function handleOrder(ctx: RouteContext, store: EntryStore, userId: string): Promise<boolean> {
  if (ctx.method !== "POST") methodNotAllowed("POST");
  const body = await readJson(ctx.req);
  if (!isValidDate(body.date)) throw new HttpError(400, "date must be a date like 2026-11-20");
  if (!isEntryHorizon(body.horizon)) throw new HttpError(400, `horizon must be one of ${ENTRY_HORIZONS.join(", ")}`);
  const ids = body.ids;
  if (!Array.isArray(ids) || ids.length > ORDER_MAX || ids.some((id) => typeof id !== "string")) throw new HttpError(400, "ids must be a list of entry ids");
  const day = store.reorder(userId, { date: body.date, horizon: body.horizon }, ids as string[]);
  if (!day) throw new HttpError(404, "those entries are not one day in that order");
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
