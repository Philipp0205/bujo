import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCsp } from "./app-kit/csp.ts";
import { sendError, sendJson } from "./app-kit/http.ts";
import { serveStatic } from "./app-kit/static.ts";
import { CalDavError } from "./caldav/client.ts";
import { loadBacklog, type TaskSource } from "./caldav/source.ts";

/** The repo root. src/ and dist/ sit at the same depth, so this holds under tsx and under node on the build. */
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const PUBLIC_DIR = path.join(ROOT_DIR, "public");

// The page loads only its own files. Inline style attributes are used by app-kit components, so style-src allows them.
const CSP = buildCsp({
  "script-src": ["'self'"],
  "style-src": ["'self'", "'unsafe-inline'"],
  "img-src": ["'self'", "data:"],
  "connect-src": ["'self'"],
  "manifest-src": ["'self'"],
  "worker-src": ["'self'"],
});

export type AppOptions = {
  source: TaskSource;
  publicDir?: string;
};

export function createApp(options: AppOptions): http.RequestListener {
  const serve = serveStatic(options.publicDir ?? PUBLIC_DIR, {
    // A file under /app-kit changes only with a new kit version. The service worker and the pages stay no-cache.
    cacheFor: (rel) => (rel.startsWith("app-kit/") ? "no-cache" : undefined),
  });

  return async (req, res) => {
    try {
      res.setHeader("content-security-policy", CSP);
      const url = new URL(req.url ?? "/", "http://localhost");
      const { pathname } = url;
      const read = req.method === "GET" || req.method === "HEAD";

      if (pathname === "/healthz") {
        if (!read) return sendJson(res, 405, { error: "method not allowed" }, { allow: "GET, HEAD" });
        return sendJson(res, 200, { ok: true });
      }

      if (pathname === "/api/backlog") {
        if (!read) return sendJson(res, 405, { error: "method not allowed" }, { allow: "GET, HEAD" });
        // Open items by default. ?status=all also returns completed and cancelled ones.
        const includeClosed = url.searchParams.get("status") === "all";
        try {
          const tasks = await loadBacklog(options.source, includeClosed);
          return sendJson(res, 200, { source: options.source.kind, lists: options.source.listNames, tasks });
        } catch (error) {
          if (error instanceof CalDavError) {
            // The message names the method and status only. It never holds the URL or credentials.
            console.error("backlog failed:", error.message);
            return sendJson(res, 502, { error: "The task server did not answer. Try again in a moment." });
          }
          throw error;
        }
      }

      if (pathname.startsWith("/api/")) return sendJson(res, 404, { error: "not found" });

      if (await serve(req, res, pathname)) return;
      sendJson(res, 405, { error: "method not allowed" }, { allow: "GET, HEAD" });
    } catch (error) {
      sendError(res, error);
    }
  };
}
