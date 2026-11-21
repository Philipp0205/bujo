import { HttpError, readJson, sendJson } from "../app-kit/http.ts";
import { createEntryStore, type EntryStore } from "../log/store.ts";
import { checkEntryPatch, checkNewEntry, checkRange } from "../log/validation.ts";
import type { Checked, Entry } from "../log/types.ts";
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
 *   POST  /api/entries             a new entry, at the end of its day
 *   PATCH /api/entries/:id         change date, type, title, tag, time or body (the markdown of a free note, null when none)
 *   POST  /api/entries/:id/sync    push again an entry whose sync failed
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

  const match = /^\/api\/entries\/([^/]+)(\/sync)?$/.exec(pathname);
  if (!match) throw new HttpError(404, "not found");
  const id = decodeId(match[1]);
  if (match[2]) {
    if (method !== "POST") methodNotAllowed("POST");
    sendJson(res, 200, { entry: retrySync(ctx, store, userId, id) });
    return true;
  }
  if (method !== "PATCH") methodNotAllowed("PATCH");
  const patch = valid(checkEntryPatch(await readJson(req, { max: ENTRY_BODY_MAX })));
  const entry = store.update(userId, id, patch, accounts.now());
  if (!entry) throw new HttpError(404, "unknown entry");
  sendJson(res, 200, { entry: ctx.sync && touchesMapping(patch) ? ctx.sync.enqueue(userId, entry) : entry });
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

function decodeId(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new HttpError(404, "unknown entry");
  }
}
