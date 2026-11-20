import { HttpError } from "../app-kit/http.ts";

/**
 * Client for the OCR service (ocr/): POST /ocr with the raw image, JSON back.
 * The photo is held as a Buffer for the length of the call and never written anywhere.
 * Errors are HttpErrors with a message that is safe to show: 503 when no service is configured,
 * 502 when it fails or does not answer, 413 and 422 when it refuses the image itself.
 */

export const OCR_TIMEOUT_MS = 60_000;

export type OcrSymbol = "•" | "x" | ">" | "<" | "○" | "–" | "none";
export const OCR_SYMBOLS: readonly OcrSymbol[] = ["•", "x", ">", "<", "○", "–", "none"];

export type OcrLine = {
  symbol: OcrSymbol;
  text: string;
  confidence: number;
  /** [x, y, w, h] in pixels of the uploaded image. */
  bbox: [number, number, number, number];
  engine: string;
};

export type OcrResult = { lines: OcrLine[]; width: number; height: number; ms: number };

/** Reads one page photo. The Buffer is not kept. */
export type OcrClient = (image: Buffer, contentType: string) => Promise<OcrResult>;

export type OcrClientOptions = {
  timeoutMs?: number;
  /** For tests. Default global fetch. */
  fetch?: typeof fetch;
};

function isOcrLine(value: unknown): value is OcrLine {
  if (!value || typeof value !== "object") return false;
  const line = value as Record<string, unknown>;
  return (
    typeof line.symbol === "string" &&
    (OCR_SYMBOLS as readonly string[]).includes(line.symbol) &&
    typeof line.text === "string" &&
    typeof line.confidence === "number" &&
    typeof line.engine === "string" &&
    Array.isArray(line.bbox) &&
    line.bbox.length === 4 &&
    line.bbox.every((n) => typeof n === "number")
  );
}

function parseResult(json: unknown): OcrResult {
  const body = json as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || !Array.isArray(body.lines) || !body.lines.every(isOcrLine)) {
    throw new HttpError(502, "The OCR service sent an answer bujo could not read.");
  }
  return {
    lines: body.lines as OcrLine[],
    width: typeof body.width === "number" ? body.width : 0,
    height: typeof body.height === "number" ? body.height : 0,
    ms: typeof body.ms === "number" ? body.ms : 0,
  };
}

/** `url` is OCR_URL, for example http://localhost:8090. Unset or empty means every call is a 503. */
export function createOcrClient(url: string | undefined, options: OcrClientOptions = {}): OcrClient {
  const base = (url ?? "").trim().replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? OCR_TIMEOUT_MS;
  const doFetch = options.fetch ?? fetch;

  return async (image, contentType) => {
    if (!base) throw new HttpError(503, "Scanning is not set up: OCR_URL is not configured.");
    let response: Response;
    try {
      response = await doFetch(`${base}/ocr`, {
        method: "POST",
        headers: { "content-type": contentType, accept: "application/json" },
        body: new Uint8Array(image),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      // The message names the failure kind only. It never holds the URL.
      console.error("ocr failed:", error instanceof Error ? error.name : "error");
      throw new HttpError(
        502,
        timedOut ? "The OCR service took too long to answer. Try again." : "The OCR service did not answer. Try again in a moment.",
      );
    }
    if (response.status === 413) throw new HttpError(413, "The OCR service says the photo is too large.");
    if (response.status === 415 || response.status === 400) {
      await response.arrayBuffer().catch(() => undefined);
      throw new HttpError(422, "The OCR service could not read this photo. Try a JPEG or PNG.");
    }
    if (!response.ok) {
      await response.arrayBuffer().catch(() => undefined);
      console.error("ocr failed: status", response.status);
      throw new HttpError(502, "The OCR service failed. Try again in a moment.");
    }
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new HttpError(502, "The OCR service sent an answer bujo could not read.");
    }
    return parseResult(json);
  };
}
