import { defaultList, guard } from "../api/tasks.ts";
import { HttpError, readBody, readJson, sendJson } from "../app-kit/http.ts";
import { isoDate } from "../app-kit/time.ts";
import { loadBacklog } from "../caldav/source.ts";
import { applyDraft } from "../scan/apply.ts";
import { buildDraft, TIME_ZONE } from "../scan/draft.ts";
import type { OcrClient } from "../scan/ocr-client.ts";
import { DRAFT_TTL_MS, type DraftStore } from "../scan/store.ts";
import { isRead, requirePrincipal, requireSession, type RouteContext } from "./context.ts";

/** A page photo from a phone camera. */
export const SCAN_MAX_BYTES = 15 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"];
const APPLY_BODY_MAX = 256 * 1024;

export type ScanDeps = { ocr: OcrClient; drafts: DraftStore; now: () => number };

function methodNotAllowed(allow: string): never {
  throw new HttpError(405, `method not allowed (use ${allow})`);
}

/**
 * /api/scan
 *   POST /api/scan             session only. Raw image body. Runs OCR and keeps a draft in memory. Never the photo.
 *   GET  /api/scan/:id         session or any agent token (read or write). Agents may only read.
 *   POST /api/scan/:id/apply   session only. Writes the accepted items. Once per draft.
 */
export async function handleScan(ctx: RouteContext, deps: ScanDeps): Promise<boolean> {
  const { req, res, method, pathname, source, who } = ctx;
  if (pathname !== "/api/scan" && !pathname.startsWith("/api/scan/")) return false;

  const segments = pathname.slice("/api/scan".length).split("/").filter(Boolean);

  if (segments.length === 0) {
    if (method !== "POST") methodNotAllowed("POST");
    requireSession(who);
    const contentType = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    if (!IMAGE_TYPES.includes(contentType)) {
      throw new HttpError(415, "send the photo as image/jpeg, image/png, image/webp or image/heic");
    }
    // Held in memory for this call only. 413 over the cap, and the rest of an oversize upload is thrown away.
    const image = await readBody(req, SCAN_MAX_BYTES, { message: "The photo is too large (at most 15 MB)." });
    if (image.length === 0) throw new HttpError(400, "The photo is empty.");
    const ocr = await deps.ocr(image, contentType);
    const now = deps.now();
    const open = await guard(() => loadBacklog(source, false));
    const draft = buildDraft({
      ocr,
      open,
      lists: source.listNames,
      defaultList: defaultList(source),
      scanDay: isoDate(now, TIME_ZONE),
      now,
      ttlMs: DRAFT_TTL_MS,
    });
    deps.drafts.add(draft);
    sendJson(res, 201, { draft });
    return true;
  }

  const id = segments[0];
  if (segments.length === 1) {
    if (!isRead(method)) methodNotAllowed("GET");
    requirePrincipal(who);
    const draft = deps.drafts.get(id);
    if (!draft) throw new HttpError(404, "This scan is gone. Drafts are kept for 24 hours.");
    sendJson(res, 200, { draft });
    return true;
  }

  if (segments.length === 2 && segments[1] === "apply") {
    if (method !== "POST") methodNotAllowed("POST");
    requireSession(who);
    const draft = deps.drafts.get(id);
    if (!draft) throw new HttpError(404, "This scan is gone. Drafts are kept for 24 hours.");
    const body = await readJson(req, { max: APPLY_BODY_MAX });
    const done = await applyDraft(source, draft, body);
    sendJson(res, 200, { results: done.results, draft: done });
    return true;
  }

  throw new HttpError(404, "not found");
}
