import { HttpError, readJson, sendJson } from "../app-kit/http.ts";
import { isoDate } from "../app-kit/time.ts";
import { createEntryStore } from "../log/store.ts";
import { applyLogDraft } from "../log/scan/apply.ts";
import { buildLogDraft, checkLines, startReview, type LogDraft } from "../log/scan/draft.ts";
import { parseReview } from "../log/scan/request.ts";
import { isValidDate } from "../log/validation.ts";
import type { OcrClient } from "../scan/ocr-client.ts";
import { readPhoto } from "../scan/photo.ts";
import { TIME_ZONE } from "../scan/draft.ts";
import { DRAFT_TTL_MS, type DraftStore } from "../scan/store.ts";
import { requireSession, type RouteContext } from "./context.ts";

const REVIEW_BODY_MAX = 256 * 1024;

export type LogScanDeps = { ocr: OcrClient; drafts: DraftStore<LogDraft>; now: () => number };

function methodNotAllowed(allow: string): never {
  throw new HttpError(405, `method not allowed (use ${allow})`);
}

/** The day to use when the page names none: ?date= (the day open in the log), else today in Berlin. */
function fallbackDay(ctx: RouteContext, now: number): string {
  const asked = ctx.url.searchParams.get("date");
  if (asked === null) return isoDate(now, TIME_ZONE);
  if (!isValidDate(asked)) throw new HttpError(400, "date must be a date like 2026-11-20");
  return asked;
}

/** The draft of a request, or a 404 when it expired or never existed. */
function draftOf(deps: LogScanDeps, id: string): LogDraft {
  const draft = deps.drafts.get(id);
  if (!draft) throw new HttpError(404, "This scan is gone. Drafts are kept for 24 hours.");
  return draft;
}

/** POST /api/log/scan: reads the photo, runs OCR, keeps a draft in memory and answers the review. Writes nothing. */
async function scanPhoto(ctx: RouteContext, deps: LogScanDeps): Promise<void> {
  const session = requireSession(ctx.who);
  const { image, contentType } = await readPhoto(ctx.req);
  const now = deps.now();
  const fallbackDate = fallbackDay(ctx, now);
  const ocr = await deps.ocr(image, contentType);
  const draft = buildLogDraft({ ocr, fallbackDate, now, ttlMs: DRAFT_TTL_MS });
  deps.drafts.add(draft);
  const store = createEntryStore(ctx.accounts.db);
  const day = draft.pageDate ?? draft.fallbackDate;
  const existing = store.list(session.user.id, { from: day, to: day });
  sendJson(ctx.res, 201, { draft: startReview(draft, existing) });
}

/** POST /api/log/scan/:id/check: tells the review which lines are duplicates or finish a task, for one day. */
async function checkDay(ctx: RouteContext, deps: LogScanDeps, id: string): Promise<void> {
  const session = requireSession(ctx.who);
  const draft = draftOf(deps, id);
  const review = parseReview(await readJson(ctx.req, { max: REVIEW_BODY_MAX }), draft);
  const existing = createEntryStore(ctx.accounts.db).list(session.user.id, { from: review.date, to: review.date });
  sendJson(ctx.res, 200, { date: review.date, items: checkLines(review.items, existing) });
}

/** POST /api/log/scan/:id/apply: writes the kept lines as entries. Once per draft. */
async function applyReview(ctx: RouteContext, deps: LogScanDeps, id: string): Promise<void> {
  const session = requireSession(ctx.who);
  const draft = draftOf(deps, id);
  const review = parseReview(await readJson(ctx.req, { max: REVIEW_BODY_MAX }), draft);
  const store = createEntryStore(ctx.accounts.db);
  const results = applyLogDraft(ctx.accounts.db, store, session.user.id, draft, review, ctx.accounts.now());
  const synced = ctx.sync ? results.map((result) => ({ ...result, entry: ctx.sync!.enqueue(session.user.id, result.entry) })) : results;
  sendJson(ctx.res, 200, { date: review.date, results: synced });
}

/**
 * /api/log/scan, the rapid-log scan. Browser sessions only: a scan reads the photo and writes entries.
 *   POST /api/log/scan?date=       raw image body. OCR, then a draft kept in memory (never the photo). Writes nothing.
 *   POST /api/log/scan/:id/check   the review's lines and day. Answers duplicates and tasks to mark done. Writes nothing.
 *   POST /api/log/scan/:id/apply   the review's lines and day. Writes the kept lines. Once per draft.
 */
export async function handleLogScan(ctx: RouteContext, deps: LogScanDeps): Promise<boolean> {
  const { pathname, method } = ctx;
  if (pathname !== "/api/log/scan" && !pathname.startsWith("/api/log/scan/")) return false;
  if (method !== "POST") methodNotAllowed("POST");
  if (pathname === "/api/log/scan") {
    await scanPhoto(ctx, deps);
    return true;
  }
  const match = /^\/api\/log\/scan\/([^/]+)\/(check|apply)$/.exec(pathname);
  if (!match) throw new HttpError(404, "not found");
  const id = decodeURIComponent(match[1]);
  if (match[2] === "check") await checkDay(ctx, deps, id);
  else await applyReview(ctx, deps, id);
  return true;
}
