import type http from "node:http";
import { HttpError, readBody } from "../app-kit/http.ts";

/** A page photo from a phone camera. */
export const SCAN_MAX_BYTES = 15 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"];

export type Photo = { image: Buffer; contentType: string };

/**
 * Reads the photo of an upload request into memory: type checked, size capped, never written anywhere.
 * Shared by every scan route so the limits stay the same. 415 for a wrong type, 413 over the cap, 400 when empty.
 */
export async function readPhoto(req: http.IncomingMessage, allowed: readonly string[] = IMAGE_TYPES): Promise<Photo> {
  const contentType = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  if (!allowed.includes(contentType)) {
    throw new HttpError(415, `send the photo as ${allowed.join(", ").replace(/, ([^,]*)$/, " or $1")}`);
  }
  // Held in memory for this call only. 413 over the cap, and the rest of an oversize upload is thrown away.
  const image = await readBody(req, SCAN_MAX_BYTES, { message: "The photo is too large (at most 15 MB)." });
  if (image.length === 0) throw new HttpError(400, "The photo is empty.");
  return { image, contentType };
}
