import { normalizeEmail } from "../app-kit/auth-code.ts";
import { HttpError, readJson, sendJson } from "../app-kit/http.ts";
import { countUsers } from "../db.ts";
import { setSeen } from "../whats-new/store.ts";
import { requireSession, textField, type RouteContext } from "./context.ts";

const NAME_MAX = 40;

function userView(user: { name: string; email: string | null; emailVerifiedAt: number | null }) {
  return { name: user.name, email: user.email, emailVerifiedAt: user.emailVerifiedAt };
}

/** The first and only account. A second one is refused, in code and by a trigger in the schema. */
function isSingleUserRefusal(error: unknown): boolean {
  return error instanceof Error && /single user/i.test(error.message);
}

/** A new account starts at the newest what's-new entry, so it does not get the whole history. */
function skipHistory(ctx: RouteContext, userId: string): void {
  const latest = ctx.whatsNew.latestId();
  if (latest) setSeen(ctx.accounts.db, userId, latest);
}

/** /api/auth/*. Returns false when the path is not one of these. */
export async function handleAuthRoutes(ctx: RouteContext): Promise<boolean> {
  const { req, res, method, pathname, accounts, who } = ctx;
  if (!pathname.startsWith("/api/auth/")) return false;
  const { auth } = accounts;
  const ip = accounts.clientIp(req);

  if (pathname === "/api/auth/status") {
    if (method !== "GET") throw new HttpError(405, "method not allowed");
    sendJson(res, 200, {
      signupOpen: countUsers(accounts.db) === 0,
      signedIn: who.kind === "session",
      emailEnabled: accounts.hasMailer,
    });
    return true;
  }

  if (pathname === "/api/auth/me") {
    if (method !== "GET") throw new HttpError(405, "method not allowed");
    const session = requireSession(who);
    sendJson(res, 200, { user: userView(session.user), emailEnabled: accounts.hasMailer });
    return true;
  }

  if (pathname === "/api/auth/signup") {
    if (method !== "POST") throw new HttpError(405, "method not allowed");
    if (!accounts.limiter.hit(`signup:${ip}`, accounts.now())) throw new HttpError(429, "too many attempts, try again later");
    const body = await readJson(req);
    const name = textField(body, "name", NAME_MAX);
    const email = typeof body.email === "string" ? body.email : "";
    // No await between this check and the insert inside signup(), so two requests cannot both pass it.
    // The schema trigger covers a second process.
    if (countUsers(accounts.db) > 0) throw new HttpError(403, "sign-up is closed: this journal already has an account");
    let created;
    try {
      created = await auth.signup({ name, email });
    } catch (error) {
      if (isSingleUserRefusal(error)) throw new HttpError(403, "sign-up is closed: this journal already has an account");
      throw error;
    }
    if (!created.ok) throw new HttpError(400, "enter a valid email");
    skipHistory(ctx, created.user.id);
    const session = await auth.startSession(created.user.id);
    sendJson(
      res,
      201,
      { recoveryCode: created.recoveryCode, user: userView(created.user), emailEnabled: accounts.hasMailer },
      { "set-cookie": accounts.sessionCookie(session.token) },
    );
    return true;
  }

  if (pathname === "/api/auth/login") {
    if (method !== "POST") throw new HttpError(405, "method not allowed");
    const body = await readJson(req);
    const login = await auth.loginByCode({ code: typeof body.code === "string" ? body.code : "", ip });
    if (!login.ok) {
      if (login.reason === "rate_limited") throw new HttpError(429, "too many attempts, try again later");
      throw new HttpError(401, "unknown recovery code");
    }
    sendJson(res, 200, { user: userView(login.user) }, { "set-cookie": accounts.sessionCookie(login.token) });
    return true;
  }

  // A malformed or missing address is a 400. A valid one always gets the same answer, whether or not it belongs to anyone.
  if (pathname === "/api/auth/lost-code") {
    if (method !== "POST") throw new HttpError(405, "method not allowed");
    const body = await readJson(req);
    const email = typeof body.email === "string" ? normalizeEmail(body.email) : null;
    if (!email) throw new HttpError(400, "enter a valid email");
    const result = await auth.requestLostCode({ email, ip });
    if (!result.ok) throw new HttpError(429, "too many attempts, try again later");
    sendJson(res, 200, { ok: true });
    return true;
  }

  // The link in the mail opens a page that posts the token from its fragment. A GET never consumes it.
  if (pathname === "/api/auth/lost-code/consume") {
    if (method !== "POST") throw new HttpError(405, "method not allowed");
    if (!accounts.limiter.hit(`consume:${ip}`, accounts.now())) throw new HttpError(429, "too many attempts, try again later");
    const body = await readJson(req);
    const result = await auth.consumeLostCode(typeof body.token === "string" ? body.token : "");
    if (!result.ok) throw new HttpError(400, "link is no longer valid");
    sendJson(
      res,
      200,
      { recoveryCode: result.recoveryCode, user: userView(result.user) },
      { "set-cookie": accounts.sessionCookie(result.token) },
    );
    return true;
  }

  if (pathname === "/api/auth/verify") {
    if (method !== "POST") throw new HttpError(405, "method not allowed");
    if (!accounts.limiter.hit(`verify:${ip}`, accounts.now())) throw new HttpError(429, "too many attempts, try again later");
    const body = await readJson(req);
    const result = await auth.verifyEmail(typeof body.token === "string" ? body.token : "");
    if (!result.ok) {
      throw new HttpError(400, result.reason === "email_taken" ? "that email is already confirmed on another account" : "link is no longer valid");
    }
    sendJson(res, 200, { email: result.user.email, emailVerifiedAt: result.user.emailVerifiedAt });
    return true;
  }

  if (pathname === "/api/auth/email") {
    if (method !== "POST") throw new HttpError(405, "method not allowed");
    const session = requireSession(who);
    const body = await readJson(req);
    const result = await auth.setEmail(session.user.id, typeof body.email === "string" ? body.email : "");
    if (!result.ok) {
      if (result.reason === "rate_limited") throw new HttpError(429, "too many attempts, try again later");
      throw new HttpError(result.reason === "not_found" ? 404 : 400, result.reason === "invalid_email" ? "enter a valid email" : "not found");
    }
    sendJson(res, 200, { user: userView(result.user) });
    return true;
  }

  if (pathname === "/api/auth/logout") {
    if (method !== "POST") throw new HttpError(405, "method not allowed");
    const session = requireSession(who);
    await auth.endSession(session.sessionToken);
    sendJson(res, 200, { ok: true }, { "set-cookie": accounts.clearCookie() });
    return true;
  }

  throw new HttpError(404, "not found");
}
