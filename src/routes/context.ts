import type http from "node:http";
import { HttpError } from "../app-kit/http.ts";
import type { Accounts, Authentication, Principal } from "../accounts/accounts.ts";
import type { TaskSource } from "../caldav/source.ts";
import type { SyncService } from "../sync/service.ts";

export type RouteContext = {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  pathname: string;
  method: string;
  accounts: Accounts;
  source: TaskSource;
  /** Pushes entries to Nextcloud. Null when CalDAV is not set up: entries then stay local. */
  sync: SyncService | null;
  who: Authentication;
};

/** True for GET and HEAD, the methods that never change anything. */
export function isRead(method: string): boolean {
  return method === "GET" || method === "HEAD";
}

/** A logged-in browser session. No credentials or a stale cookie is 401, an agent token is 403. */
export function requireSession(who: Authentication): Extract<Principal, { kind: "session" }> {
  if (who.kind === "session") return who;
  if (who.kind === "agent") throw new HttpError(403, "agent tokens cannot do this");
  throw new HttpError(401, "sign in first");
}

/** Any signed-in caller, browser or agent. */
export function requirePrincipal(who: Authentication): Principal {
  if (who.kind === "session" || who.kind === "agent") return who;
  throw new HttpError(401, who.kind === "invalid" ? "invalid or revoked credentials" : "sign in first");
}

/** A string field, trimmed. Anything else is a 400 that names the field. */
export function textField(body: Record<string, unknown>, key: string, max: number): string {
  const value = body[key];
  if (typeof value !== "string") throw new HttpError(400, `${key} is required`);
  const trimmed = value.trim();
  if (trimmed === "") throw new HttpError(400, `${key} is required`);
  if (trimmed.length > max) throw new HttpError(400, `${key} is too long (at most ${max} characters)`);
  // A name or label is one line of plain text.
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) throw new HttpError(400, `${key} must be one line of plain text`);
  return trimmed;
}
