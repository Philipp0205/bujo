import { AgentTokenLimitError, AGENT_NAME_MAX, issueAgentToken, listAgentTokens, revokeAgentToken, type AgentScope } from "../accounts/agent-tokens.ts";
import { HttpError, readJson, sendJson } from "../app-kit/http.ts";
import { requireSession, textField, type RouteContext } from "./context.ts";

/** /api/tokens. Browser sessions only: an agent token can never list, create or revoke tokens. */
export async function handleTokenRoutes(ctx: RouteContext): Promise<boolean> {
  const { req, res, method, pathname, accounts, who } = ctx;
  if (pathname !== "/api/tokens" && !pathname.startsWith("/api/tokens/")) return false;
  const session = requireSession(who);
  const db = accounts.db;

  if (pathname === "/api/tokens") {
    if (method === "GET" || method === "HEAD") {
      sendJson(res, 200, { tokens: listAgentTokens(db, session.user.id) });
      return true;
    }
    if (method === "POST") {
      const body = await readJson(req);
      for (const key of Object.keys(body)) {
        if (key !== "name" && key !== "scope") throw new HttpError(400, `unknown field: ${key}`);
      }
      const name = textField(body, "name", AGENT_NAME_MAX);
      if (body.scope !== "read" && body.scope !== "write") throw new HttpError(400, "scope must be read or write");
      try {
        const issued = issueAgentToken(db, session.user.id, { name, scope: body.scope as AgentScope }, accounts.now());
        // The plain token is in this response and nowhere else, ever.
        sendJson(res, 201, { token: issued.token, info: { ...issued, token: undefined } });
      } catch (error) {
        if (error instanceof AgentTokenLimitError) throw new HttpError(409, error.message);
        throw error;
      }
      return true;
    }
    throw new HttpError(405, "method not allowed");
  }

  // /api/tokens/:id is revoke. There is no DELETE: a revoke is a POST that marks the token, nothing is removed.
  const match = /^\/api\/tokens\/([^/]+)\/revoke$/.exec(pathname);
  if (match) {
    if (method !== "POST") throw new HttpError(405, "method not allowed");
    let id: string;
    try {
      id = decodeURIComponent(match[1]);
    } catch {
      throw new HttpError(404, "unknown token");
    }
    if (!revokeAgentToken(db, session.user.id, id, accounts.now())) throw new HttpError(404, "unknown token");
    sendJson(res, 200, { ok: true });
    return true;
  }
  throw new HttpError(404, "not found");
}
