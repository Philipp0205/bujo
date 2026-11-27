import { HttpError, sendJson } from "../app-kit/http.ts";
import { listIndex } from "../log/page-index.ts";
import { isRead, requireSession, type RouteContext } from "./context.ts";

/**
 * /api/index, the notebook index. Browser sessions only.
 *   GET /api/index   { pages }: every known paper page of the user (of every notebook, not only the active one: GET /api/notebooks/:id
 *                    has one notebook's), ascending by number (ties: day, month, future, collection, then ref, then page).
 *                    Each: { number, kind: "day" | "month" | "future" | "collection", ref, page, label? }. ref is a date (day), a month
 *                    YYYY-MM (month, and a future log's first month) or a collection id. page is the physical page of a day, else 1.
 *                    label is only set for a collection (its name). Gaps in the numbers are normal.
 */
export function handlePageIndex(ctx: RouteContext): boolean {
  if (ctx.pathname !== "/api/index") return false;
  const userId = requireSession(ctx.who).user.id;
  if (!isRead(ctx.method)) throw new HttpError(405, "method not allowed (use GET)");
  sendJson(ctx.res, 200, { pages: listIndex(ctx.accounts.db, userId) });
  return true;
}
