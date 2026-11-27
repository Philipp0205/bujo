import { HttpError, SECURITY_HEADERS, sendJson } from "../app-kit/http.ts";
import { createPagePhotoStore, type PhotoKind, type PhotoPlace } from "../log/page-photos.ts";
import { looksLikeJpeg, readPhoto } from "../scan/photo.ts";
import { isRead, requireSession, type RouteContext } from "./context.ts";

/** A page photo is at most this big. The client sends 2000px JPEGs, about 300 KB. */
const PAGE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const KEPT_KINDS: readonly PhotoKind[] = ["day", "month", "future"];
const REF_MAX = 40;

/** The page a POST names: ?kind=&ref=&page= for a day, month or future log, or ?collection= for a collection. 400 when it is not a page. */
function placeOf(params: URLSearchParams): PhotoPlace {
  const collection = params.get("collection");
  if (collection) return { kind: "collection", ref: collection.slice(0, REF_MAX * 2), page: 1 };
  const kind = params.get("kind") as PhotoKind | null;
  const ref = params.get("ref") ?? "";
  const page = Number(params.get("page") ?? "1");
  if (!kind || !KEPT_KINDS.includes(kind)) throw new HttpError(400, "kind must be day, month or future (or send collection)");
  if (ref === "" || ref.length > REF_MAX) throw new HttpError(400, "ref is required");
  if (!Number.isInteger(page) || page < 1 || page > 99) throw new HttpError(400, "page must be a whole number from 1 to 99");
  return { kind, ref, page };
}

/**
 * /api/page-photos, the kept photos of scanned notebook pages. Browser sessions only. The JPEGs are files in a page-photos folder next to
 * the database (the photoDir dependency); without one nothing can be kept and POST answers 503.
 *   POST /api/page-photos?kind=&ref=&page=   a raw image/jpeg body (at most 5 MB): adds a photo to that page and answers 201 { id }. kind is
 *        day, month or future, ref a date or month, page the physical page of a day (default 1). Or ?collection=<id> for a collection.
 *        Older photos of the page stay: a rescan adds one. 415 not a JPEG, 413 too large, 404 unknown collection
 *   GET  /api/page-photos/:id                the JPEG, private cache headers. 404 when it is not the user's
 * The photos of a page are listed by GET /api/notebooks/:id: each page has photos [{ id, createdAt }], newest first.
 */
export async function handlePagePhotos(ctx: RouteContext, dir: string | undefined): Promise<boolean> {
  const one = /^\/api\/page-photos\/([^/]+)$/.exec(ctx.pathname);
  if (!one && ctx.pathname !== "/api/page-photos") return false;
  const userId = requireSession(ctx.who).user.id;
  if (!one) return upload(ctx, userId, dir);
  if (!isRead(ctx.method)) throw new HttpError(405, "method not allowed (use GET)");
  if (!dir) throw new HttpError(404, "no photo");
  const image = createPagePhotoStore(ctx.accounts.db, dir).read(userId, decodeURIComponent(one[1]!));
  if (!image) throw new HttpError(404, "no photo");
  ctx.res.writeHead(200, { ...SECURITY_HEADERS, "cache-control": "private, max-age=86400", "content-type": "image/jpeg", "content-length": image.length });
  ctx.res.end(ctx.method === "HEAD" ? undefined : image);
  return true;
}

/** POST: checks the page and the bytes, then keeps the photo. */
async function upload(ctx: RouteContext, userId: string, dir: string | undefined): Promise<boolean> {
  if (ctx.method !== "POST") throw new HttpError(405, "method not allowed (use POST)");
  if (!dir) throw new HttpError(503, "Page photos are not kept: the server has no folder for them.");
  const place = placeOf(ctx.url.searchParams);
  const { image } = await readPhoto(ctx.req, ["image/jpeg"], PAGE_PHOTO_MAX_BYTES);
  if (!looksLikeJpeg(image)) throw new HttpError(415, "the photo is not a JPEG file");
  const id = createPagePhotoStore(ctx.accounts.db, dir).add(userId, place, image, ctx.accounts.now());
  if (!id) throw new HttpError(404, "unknown collection");
  sendJson(ctx.res, 201, { id });
  return true;
}
