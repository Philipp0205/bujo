import type http from "node:http";
import { createAuth, type Auth, type AuthLimiter, type AuthUser } from "../app-kit/auth.ts";
import { clientKey } from "../app-kit/client-key.ts";
import type { Mailer } from "../app-kit/mailer.ts";
import { createRateLimiter } from "../app-kit/rate-limit.ts";
import type { Db } from "../db.ts";
import { findAgentToken, type AgentToken } from "./agent-tokens.ts";
import { createAuthStore } from "./auth-store.ts";

export const SESSION_COOKIE = "bujo_session";
/** Sign-in, sign-up, lost-code and email attempts. Shared by every request of this process. */
export const ACCOUNT_LIMIT = { limit: 10, windowMs: 10 * 60_000 };
const SESSION_MAX_AGE_S = 180 * 24 * 60 * 60;

export type AccountsOptions = {
  db: Db;
  /** Public origin of this app, no trailing slash, for example https://bujo.example. Mail links point here, never at the Host header. */
  origin: string;
  /** No mailer = email is off: confirm and lost-code mails are not sent. */
  mailer?: Mailer | undefined;
  /** Default: 10 attempts per 10 minutes. A test can inject a looser one. */
  limiter?: AuthLimiter;
  now?: () => number;
  /** Trust the right-most X-Forwarded-For hop as the client address. Only behind a proxy that appends to it. */
  trustProxy?: boolean;
};

/** Who is calling. A session is a person in the browser, an agent is a bearer token. */
export type Principal =
  | { kind: "session"; user: AuthUser; sessionToken: string }
  | { kind: "agent"; user: AuthUser; token: AgentToken };

/** "none" = no credentials at all. "invalid" = credentials were sent and are not good. */
export type Authentication = { kind: "none" } | { kind: "invalid" } | Principal;

export type Accounts = {
  auth: Auth;
  db: Db;
  origin: string;
  hasMailer: boolean;
  now(): number;
  limiter: AuthLimiter;
  clientIp(req: http.IncomingMessage): string;
  /** The Set-Cookie value that starts a session. */
  sessionCookie(token: string): string;
  /** The Set-Cookie value that ends it. */
  clearCookie(): string;
  authenticate(req: http.IncomingMessage): Promise<Authentication>;
};

export function createAccounts(options: AccountsOptions): Accounts {
  const origin = options.origin.replace(/\/+$/, "");
  const secure = origin.startsWith("https://");
  const now = options.now ?? Date.now;
  const limiter = options.limiter ?? createRateLimiter(ACCOUNT_LIMIT);
  const store = createAuthStore(options.db);
  const auth = createAuth({
    store,
    mailer: options.mailer,
    limiter,
    appName: "bujo",
    now,
    // Signing in on one device signs the others out, so a lost-code mail takes the account back.
    revokeOtherSessions: true,
    linkUrl: (kind, token) => `${origin}/${kind === "verify" ? "verify" : "recover"}#t=${token}`,
  });

  function cookieAttributes(): string {
    return `Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
  }

  return {
    auth,
    db: options.db,
    origin,
    hasMailer: Boolean(options.mailer),
    now,
    limiter,
    clientIp: (req) => (options.trustProxy ? clientKey(req) : req.socket?.remoteAddress || "unknown"),
    sessionCookie: (token) => `${SESSION_COOKIE}=${token}; ${cookieAttributes()}; Max-Age=${SESSION_MAX_AGE_S}`,
    clearCookie: () => `${SESSION_COOKIE}=; ${cookieAttributes()}; Max-Age=0`,

    async authenticate(req) {
      const header = req.headers.authorization;
      if (header !== undefined) {
        // A bearer header means agent auth only. A bad token never falls back to the cookie.
        const match = /^Bearer[ \t]+(\S+)$/i.exec(header);
        if (!match) return { kind: "invalid" };
        const token = findAgentToken(options.db, match[1], now());
        if (!token) return { kind: "invalid" };
        const user = await store.findUserById(token.userId);
        if (!user) return { kind: "invalid" };
        return { kind: "agent", user, token };
      }
      const sessionToken = readCookie(req, SESSION_COOKIE);
      if (!sessionToken) return { kind: "none" };
      const user = await auth.userForToken(sessionToken);
      if (!user) return { kind: "invalid" };
      return { kind: "session", user, sessionToken };
    },
  };
}

/** One cookie by name. Cookie headers are small and simple, so this is a split rather than a library. */
export function readCookie(req: http.IncomingMessage, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== name) continue;
    const value = part.slice(index + 1).trim();
    return value === "" ? undefined : value;
  }
  return undefined;
}
