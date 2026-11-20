import { HttpError, readJson, sendJson } from "../app-kit/http.ts";
import { createEntryStore } from "../log/store.ts";
import { checkEntryPatch, checkNewEntry, checkRange } from "../log/validation.ts";
import type { Checked } from "../log/types.ts";
import { isRead, requireSession, type RouteContext } from "./context.ts";

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
 *   PATCH /api/entries/:id         change date, type, title, tag or time
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
    const input = valid(checkNewEntry(await readJson(req)));
    sendJson(res, 201, { entry: store.create(userId, input, accounts.now()) });
    return true;
  }

  const match = /^\/api\/entries\/([^/]+)$/.exec(pathname);
  if (!match) throw new HttpError(404, "not found");
  if (method !== "PATCH") methodNotAllowed("PATCH");
  const id = decodeId(match[1]);
  const patch = valid(checkEntryPatch(await readJson(req)));
  const entry = store.update(userId, id, patch, accounts.now());
  if (!entry) throw new HttpError(404, "unknown entry");
  sendJson(res, 200, { entry });
  return true;
}

function decodeId(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new HttpError(404, "unknown entry");
  }
}
