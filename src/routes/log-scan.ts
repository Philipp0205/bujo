import { HttpError, readJson, sendJson } from "../app-kit/http.ts";
import { isoDate } from "../app-kit/time.ts";
import { createEntryStore } from "../log/store.ts";
import { createTraceStore } from "../log/trace.ts";
import { applyLogDraft } from "../log/scan/apply.ts";
import { buildLogDraft, checkPlaced, pagesOf, startReview, type LogDraft } from "../log/scan/draft.ts";
import { suggestNote } from "../log/scan/note.ts";
import { matchNote } from "../log/scan/note-match.ts";
import { pageReader, type SlotReader } from "../log/scan/plan.ts";
import { storeReader } from "../log/scan/reader.ts";
import { parseReview, placeReview, type SentReview } from "../log/scan/request.ts";
import { isPageKind, VIEW_HINTS, type ViewHint } from "../log/scan/types.ts";
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

/** The log view open when scanning: ?view=daily|future|month, or none. A weak hint for the page kind. */
function viewHint(ctx: RouteContext): ViewHint | null {
  const asked = ctx.url.searchParams.get("view");
  if (asked === null) return null;
  if (!(VIEW_HINTS as readonly string[]).includes(asked)) throw new HttpError(400, `view must be one of ${VIEW_HINTS.join(", ")}`);
  return asked as ViewHint;
}

/** The draft of a request, or a 404 when it expired or never existed. */
function draftOf(deps: LogScanDeps, id: string): LogDraft {
  const draft = deps.drafts.get(id);
  if (!draft) throw new HttpError(404, "This scan is gone. Drafts are kept for 24 hours.");
  return draft;
}

/** The slot reader of a request: entries and traces of the signed-in user, read once per slot. */
function readerOf(ctx: RouteContext, userId: string) {
  return storeReader(createEntryStore(ctx.accounts.db), createTraceStore(ctx.accounts.db), userId);
}

/** POST /api/log/scan: reads the photo, runs OCR, keeps a draft in memory and answers the review. Writes nothing. */
async function scanPhoto(ctx: RouteContext, deps: LogScanDeps): Promise<void> {
  const session = requireSession(ctx.who);
  const hint = viewHint(ctx);
  const { image, contentType } = await readPhoto(ctx.req);
  const now = deps.now();
  const fallbackDate = fallbackDay(ctx, now);
  const ocr = await deps.ocr(image, contentType);
  const draft = buildLogDraft({ ocr, fallbackDate, now, ttlMs: DRAFT_TTL_MS, hint });
  deps.drafts.add(draft);
  sendJson(ctx.res, 201, { draft: startReview(draft, readerOf(ctx, session.user.id)) });
}

/** POST /api/log/scan/note: reads the photo, runs OCR and answers a suggested title, day and markdown. Keeps nothing, writes nothing. */
async function scanNote(ctx: RouteContext, deps: LogScanDeps): Promise<void> {
  const session = requireSession(ctx.who);
  const { image, contentType } = await readPhoto(ctx.req);
  const fallbackDate = fallbackDay(ctx, deps.now());
  const ocr = await deps.ocr(image, contentType);
  const note = suggestNote(ocr.lines, fallbackDate);
  const match = matchNote(note, createEntryStore(ctx.accounts.db).listNotes(session.user.id));
  sendJson(ctx.res, 200, { note, match });
}

/** POST /api/log/scan/:id/kind: reads the page again as the kind the person picked and answers a fresh review. Edits made before are not carried over. */
async function switchKind(ctx: RouteContext, deps: LogScanDeps, id: string): Promise<void> {
  const session = requireSession(ctx.who);
  const draft = draftOf(deps, id);
  if (draft.applied) throw new HttpError(409, "This scan was already applied.");
  const body = await readJson(ctx.req, { max: REVIEW_BODY_MAX });
  const extra = Object.keys(body).find((key) => key !== "kind");
  if (extra) throw new HttpError(400, `unknown field: ${extra.slice(0, 40)}`);
  if (!isPageKind(body.kind)) throw new HttpError(400, "kind must be daily, future, calendar or month-task");
  sendJson(ctx.res, 200, { draft: startReview(draft, readerOf(ctx, session.user.id), body.kind) });
}

/** The pages a daily review's day has paper for, so the page picker follows a day the person changed. Empty for any other kind. */
function existingPages(review: SentReview, reader: SlotReader, fallbackDate: string): number[] {
  if (review.kind !== "daily") return [];
  return pagesOf(reader.entries({ horizon: "day", date: review.date ?? fallbackDate }));
}

/** POST /api/log/scan/:id/check: tells the review which lines are new, edited or unchanged in their slots, with before and after for edits. */
async function checkSlots(ctx: RouteContext, deps: LogScanDeps, id: string): Promise<void> {
  const session = requireSession(ctx.who);
  const draft = draftOf(deps, id);
  const review = parseReview(await readJson(ctx.req, { max: REVIEW_BODY_MAX }), draft);
  const reader = readerOf(ctx, session.user.id);
  const items = checkPlaced(placeReview(review, draft.fallbackDate), pageReader(reader, review.page));
  const extra = review.kind === "daily" ? {} : { kind: review.kind, month: review.month };
  sendJson(ctx.res, 200, { date: review.date, page: review.page, pages: existingPages(review, reader, draft.fallbackDate), items, ...extra });
}

/** POST /api/log/scan/:id/apply: adds the kept new lines and updates the kept edited ones. Once per draft. Never deletes. */
async function applyReview(ctx: RouteContext, deps: LogScanDeps, id: string): Promise<void> {
  const session = requireSession(ctx.who);
  const draft = draftOf(deps, id);
  const review = parseReview(await readJson(ctx.req, { max: REVIEW_BODY_MAX }), draft);
  const store = createEntryStore(ctx.accounts.db);
  const results = applyLogDraft(ctx.accounts.db, store, readerOf(ctx, session.user.id), session.user.id, draft, review, ctx.accounts.now());
  const synced = ctx.sync ? results.map(({ unflag, ...result }) => ({ ...result, entry: ctx.sync!.enqueue(session.user.id, result.entry, { unflag }) })) : results.map(({ unflag, ...result }) => result);
  sendJson(ctx.res, 200, { kind: review.kind, date: review.date, month: review.month, page: review.page, results: synced });
}

/**
 * /api/log/scan, the log-page scan. Browser sessions only: a scan reads the photo and writes entries.
 *   POST /api/log/scan?date=&view=  raw image body. OCR, then a draft kept in memory (never the photo). Writes nothing. The page kind
 *                                   (daily, future, calendar or month-task) is found from the OCR lines, the LLM's word and the view
 *                                   (daily, future or month) the person had open.
 *   POST /api/log/scan/note?date=   raw image body. OCR, then a suggested title, day and markdown for a free note, and `match`: the
 *                                   person's saved note this page most likely is (id, title, date, body), or null. Keeps and writes
 *                                   nothing: the note is saved by the review through POST /api/entries (or PATCHed when updating).
 *   POST /api/log/scan/:id/kind     { kind }. Reads the page again as that kind and answers a fresh review. Writes nothing.
 *   POST /api/log/scan/:id/check    the review's kind, day or month, page and lines. Answers new, edited (with before and after) or unchanged
 *                                   per line, each against its own slot and the entries of that physical page (and those not on paper).
 *                                   Also answers the pages the day has paper for. Writes nothing.
 *   POST /api/log/scan/:id/apply    the same body. Adds the kept new lines and updates the kept edited ones (outcome "created" or
 *                                   "updated") and files them on the page, in the order of the paper. A page left out is page 1.
 *                                   Skipped lines may be sent so unchanged ones are recorded. Once per draft.
 *                                   An entry no line names is never touched, and nothing is deleted.
 */
export async function handleLogScan(ctx: RouteContext, deps: LogScanDeps): Promise<boolean> {
  const { pathname, method } = ctx;
  if (pathname !== "/api/log/scan" && !pathname.startsWith("/api/log/scan/")) return false;
  if (method !== "POST") methodNotAllowed("POST");
  if (pathname === "/api/log/scan") {
    await scanPhoto(ctx, deps);
    return true;
  }
  if (pathname === "/api/log/scan/note") {
    await scanNote(ctx, deps);
    return true;
  }
  const match = /^\/api\/log\/scan\/([^/]+)\/(check|apply|kind)$/.exec(pathname);
  if (!match) throw new HttpError(404, "not found");
  const id = decodeURIComponent(match[1]);
  if (match[2] === "check") await checkSlots(ctx, deps, id);
  else if (match[2] === "kind") await switchKind(ctx, deps, id);
  else await applyReview(ctx, deps, id);
  return true;
}
