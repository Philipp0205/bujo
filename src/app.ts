import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAccounts } from "./accounts/accounts.ts";
import type { AuthLimiter } from "./app-kit/auth.ts";
import { buildCsp } from "./app-kit/csp.ts";
import { HttpError, SECURITY_HEADERS, sendError, sendJson } from "./app-kit/http.ts";
import type { Mailer } from "./app-kit/mailer.ts";
import { serveStatic } from "./app-kit/static.ts";
import { CalDavError } from "./caldav/client.ts";
import { loadBacklog, type TaskSource } from "./caldav/source.ts";
import { countUsers, type Db } from "./db.ts";
import { handleAuthRoutes } from "./routes/auth.ts";
import { isRead, requireSession, type RouteContext } from "./routes/context.ts";
import { handleEntryRoutes } from "./routes/entries.ts";
import { handleCollectionRoutes } from "./routes/collections.ts";
import { handlePageIndex } from "./routes/page-index.ts";
import { handlePagePhotos } from "./routes/page-photos.ts";
import { handleNotebookRoutes } from "./routes/notebooks.ts";
import { handleLogScan, type LogScanDeps } from "./routes/log-scan.ts";
import { handleMcp } from "./routes/mcp.ts";
import { handleScan, type ScanDeps } from "./routes/scan.ts";
import { handleTokenRoutes } from "./routes/tokens.ts";
import { handleApiV1 } from "./routes/v1.ts";
import { handleWhatsNewRoutes } from "./routes/whats-new.ts";
import { createOcrClient, type OcrClient } from "./scan/ocr-client.ts";
import { createDraftStore, type DraftStore } from "./scan/store.ts";
import type { SyncService } from "./sync/service.ts";
import { createCatalog } from "./whats-new/catalog.ts";

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
  db: Db;
  /** Public origin, for mail links and the Secure cookie flag. Default http://localhost. */
  origin?: string;
  mailer?: Mailer | undefined;
  /** Replaces the default 10 attempts per 10 minutes. Tests pass a looser one. */
  limiter?: AuthLimiter;
  now?: () => number;
  trustProxy?: boolean;
  publicDir?: string;
  /** Reads a page photo. Default: the service at OCR_URL (a 503 when it is not set). Tests pass a fake. */
  ocr?: OcrClient;
  /** Scan drafts, in memory. Tests may pass their own. */
  drafts?: DraftStore;
  /** Pushes task entries to Nextcloud. Leave out to keep every entry local. */
  sync?: SyncService;
  /** The folder the page photos (JPEG files) are kept in. Leave out to keep none: the upload route then answers 503. */
  photoDir?: string;
};

/** Pages that need a session. The file is what is served once the person is signed in. */
const APP_PAGES: Record<string, string> = {
  "/": "/index.html",
  "/index.html": "/index.html",
  "/backlog": "/backlog.html",
  "/backlog.html": "/backlog.html",
  "/notes": "/notes.html",
  "/notes.html": "/notes.html",
  "/scan": "/scan.html",
  "/scan.html": "/scan.html",
  "/settings": "/settings.html",
  "/settings.html": "/settings.html",
};

/** Sign-in pages share one file. A signed-in person is sent to the app instead. */
const GUEST_PAGES = new Set(["/signin", "/signup", "/lost", "/auth.html"]);

/** Pages reached from a mail link. Open to everyone: the token in the fragment is the credential. */
const LINK_PAGES = new Set(["/verify", "/recover"]);

function redirect(res: http.ServerResponse, location: string): void {
  res.writeHead(302, { ...SECURITY_HEADERS, location, "content-length": "0" });
  res.end();
}

/** An unsafe request from a page of another site carries a foreign Origin. Refuse it unless it is a bearer call. */
function foreignOrigin(req: http.IncomingMessage, publicOrigin: string): boolean {
  const header = req.headers.origin;
  if (typeof header !== "string") return false;
  let host: string;
  try {
    host = new URL(header).host;
  } catch {
    return true;
  }
  let own = "";
  try {
    own = new URL(publicOrigin).host;
  } catch {
    // An unparseable configured origin simply does not match.
  }
  return host !== req.headers.host && host !== own;
}

export function createApp(options: AppOptions): http.RequestListener {
  const origin = options.origin ?? "http://localhost";
  const ocr = options.ocr ?? createOcrClient(process.env.OCR_URL);
  const now = options.now ?? Date.now;
  const scan: ScanDeps = { ocr, drafts: options.drafts ?? createDraftStore({ now: options.now }), now };
  const logScan: LogScanDeps = { ocr, drafts: createDraftStore({ now: options.now }), now };
  const accounts = createAccounts({
    db: options.db,
    origin,
    mailer: options.mailer,
    limiter: options.limiter,
    now: options.now,
    trustProxy: options.trustProxy,
  });
  const whatsNew = createCatalog(options.publicDir ?? PUBLIC_DIR);
  const serve = serveStatic(options.publicDir ?? PUBLIC_DIR, {
    // A file under /app-kit changes only with a new kit version. The service worker and the pages stay no-cache.
    cacheFor: (rel) => (rel.startsWith("app-kit/") ? "no-cache" : undefined),
    // An unknown path is a 404, never the app shell.
    fallback: false,
  });

  return async (req, res) => {
    try {
      res.setHeader("content-security-policy", CSP);
      const url = new URL(req.url ?? "/", "http://localhost");
      const { pathname } = url;
      const method = req.method ?? "GET";
      const read = isRead(method);

      if (pathname === "/healthz") {
        if (!read) return sendJson(res, 405, { error: "method not allowed" }, { allow: "GET, HEAD" });
        return sendJson(res, 200, { ok: true });
      }

      const who = await accounts.authenticate(req);

      // A cross-site form or fetch can carry the cookie but not a matching Origin.
      if (!read && who.kind !== "agent" && foreignOrigin(req, origin)) throw new HttpError(403, "cross-site request refused");

      const ctx: RouteContext = { req, res, url, pathname, method, accounts, source: options.source, sync: options.sync ?? null, whatsNew, who };

      if (pathname === "/api/backlog") {
        if (!read) return sendJson(res, 405, { error: "method not allowed" }, { allow: "GET, HEAD" });
        requireSession(who);
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

      if (await handleAuthRoutes(ctx)) return;
      if (await handleTokenRoutes(ctx)) return;
      if (await handleWhatsNewRoutes(ctx)) return;
      if (await handleApiV1(ctx)) return;
      if (await handleScan(ctx, scan)) return;
      if (await handleLogScan(ctx, logScan)) return;
      if (await handleEntryRoutes(ctx)) return;
      if (await handlePagePhotos(ctx, options.photoDir)) return;
      if (await handleCollectionRoutes(ctx, options.photoDir)) return;
      if (await handleNotebookRoutes(ctx)) return;
      if (handlePageIndex(ctx)) return;
      if (await handleMcp(ctx)) return;

      if (pathname.startsWith("/api/")) return sendJson(res, 404, { error: "not found" });

      const appPage = APP_PAGES[pathname];
      if (appPage) {
        if (!read) return sendJson(res, 405, { error: "method not allowed" }, { allow: "GET, HEAD" });
        if (who.kind !== "session") {
          const first = countUsers(accounts.db) === 0;
          return redirect(res, first ? "/signup" : "/signin");
        }
        if (await serve(req, res, appPage)) return;
      }

      if (GUEST_PAGES.has(pathname) || LINK_PAGES.has(pathname)) {
        if (!read) return sendJson(res, 405, { error: "method not allowed" }, { allow: "GET, HEAD" });
        if (GUEST_PAGES.has(pathname)) {
          if (who.kind === "session") return redirect(res, "/");
          const first = countUsers(accounts.db) === 0;
          // Sign-up is open once. Before it, /signin has nothing to sign in to. After it, /signup is closed.
          if (pathname === "/signin" && first) return redirect(res, "/signup");
          if (pathname === "/signup" && !first) return redirect(res, "/signin");
        }
        if (await serve(req, res, "/auth.html")) return;
      }

      if (await serve(req, res, pathname)) return;
      sendJson(res, 405, { error: "method not allowed" }, { allow: "GET, HEAD" });
    } catch (error) {
      sendError(res, error);
    }
  };
}
