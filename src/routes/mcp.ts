import { HttpError, readBody, sendEmpty, sendJson } from "../app-kit/http.ts";
import { handleMessage } from "../mcp/handler.ts";
import { API_BODY_MAX } from "./v1.ts";
import type { RouteContext } from "./context.ts";

/** Only the host that serves bujo (or its configured origin) may call /mcp from a browser. A client with no Origin header is fine. */
function originAllowed(ctx: RouteContext): boolean {
  const header = ctx.req.headers.origin;
  if (typeof header !== "string") return true;
  try {
    const host = new URL(header).host;
    return host === ctx.req.headers.host || host === new URL(ctx.accounts.origin).host;
  } catch {
    return false;
  }
}

/**
 * POST /mcp. Agent tokens only: a browser cookie is not accepted here, so a web page cannot drive it.
 * GET and DELETE are 405 with Allow: POST (no server-sent event stream, no session to end).
 */
export async function handleMcp(ctx: RouteContext): Promise<boolean> {
  const { req, res, method, pathname, source, who } = ctx;
  if (pathname !== "/mcp") return false;

  if (method !== "POST") {
    sendJson(res, 405, { error: "method not allowed (use POST)" }, { allow: "POST" });
    return true;
  }
  if (!originAllowed(ctx)) throw new HttpError(403, "origin not allowed");
  if (who.kind !== "agent") {
    throw new HttpError(401, who.kind === "session" ? "use an agent token (Authorization: Bearer bujo_...)" : "sign in with an agent token");
  }

  const raw = await readBody(req, API_BODY_MAX);
  let message: unknown;
  try {
    message = JSON.parse(raw.toString("utf8"));
  } catch {
    sendJson(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
    return true;
  }
  if (Array.isArray(message)) {
    sendJson(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "batches are not supported, send one message" } });
    return true;
  }

  const result = await handleMessage(source, who.token.scope, message);
  if (result.kind === "accepted") sendEmpty(res, 202);
  else sendJson(res, 200, result.body);
  return true;
}
