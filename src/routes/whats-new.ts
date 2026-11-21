import { HttpError, readJson, sendJson } from "../app-kit/http.ts";
import { getSeen, setSeen } from "../whats-new/store.ts";
import { requireSession, type RouteContext } from "./context.ts";

/** /api/whats-new/seen. Browser sessions only: reads and writes the newest what's-new id the account has seen. */
export async function handleWhatsNewRoutes(ctx: RouteContext): Promise<boolean> {
  const { req, res, method, pathname, accounts, who, whatsNew } = ctx;
  if (pathname !== "/api/whats-new/seen") return false;
  const session = requireSession(who);

  if (method === "GET" || method === "HEAD") {
    sendJson(res, 200, { seen: getSeen(accounts.db, session.user.id) });
    return true;
  }
  if (method === "PUT") {
    const body = await readJson(req);
    if (!whatsNew.isValidId(body.id)) throw new HttpError(400, "id must be 1 to 64 characters of a-z, 0-9 and -");
    setSeen(accounts.db, session.user.id, body.id as string);
    sendJson(res, 200, { seen: body.id });
    return true;
  }
  throw new HttpError(405, "method not allowed");
}
