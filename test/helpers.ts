import http from "node:http";
import type { AddressInfo } from "node:net";
import { stubMailer } from "../src/app-kit/mailer.ts";
import { createApp, type AppOptions } from "../src/app.ts";
import { openDb, type Db } from "../src/db.ts";
import type { TaskSource } from "../src/caldav/source.ts";

export type TestApp = {
  base: string;
  db: Db;
  mailer: ReturnType<typeof stubMailer>;
  close(): Promise<void>;
};

/** A limiter that never says no, so a test is not slowed by the real 10-per-10-minutes cap. */
export const looseLimiter = { hit: () => true };

/**
 * The app on a random 127.0.0.1 port with an in-memory database and the kit's stubMailer.
 * No real mail is sent and no real Nextcloud is reached.
 */
export async function startApp(
  source: TaskSource,
  options: Partial<Omit<AppOptions, "source" | "db">> = {},
): Promise<TestApp> {
  const db = openDb(":memory:");
  const mailer = stubMailer();
  const origin = options.origin ?? "http://localhost";
  const server = http.createServer(
    createApp({ source, db, mailer, limiter: looseLimiter, origin, ...options }),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    db,
    mailer,
    async close() {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
    },
  };
}

export async function withApp(
  source: TaskSource,
  fn: (app: TestApp) => Promise<void>,
  options: Partial<Omit<AppOptions, "source" | "db">> = {},
): Promise<void> {
  const app = await startApp(source, options);
  try {
    await fn(app);
  } finally {
    await app.close();
  }
}

/** The name=value part of the session cookie in a response, or undefined. */
export function sessionCookieOf(response: Response): string | undefined {
  const header = response.headers.getSetCookie().find((value) => value.startsWith("bujo_session="));
  if (!header) return undefined;
  const pair = header.split(";")[0];
  return pair === "bujo_session=" ? undefined : pair;
}

export type Signed = { cookie: string; recoveryCode: string; headers: { cookie: string } };

/** Creates the one account over HTTP and returns the session cookie and the recovery code. */
export async function signUp(base: string, body: { name?: string; email?: string } = {}): Promise<Signed> {
  const response = await fetch(`${base}/api/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: body.name ?? "Philipp", email: body.email ?? "philipp@example.com" }),
  });
  if (response.status !== 201) throw new Error(`signup answered ${response.status}`);
  const cookie = sessionCookieOf(response);
  if (!cookie) throw new Error("signup set no session cookie");
  const json = (await response.json()) as { recoveryCode: string };
  return { cookie, recoveryCode: json.recoveryCode, headers: { cookie } };
}

/** JSON request helper. Pass headers (a cookie or a bearer) to sign it. */
export async function api(
  base: string,
  method: string,
  path: string,
  options: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; json: any; response: Response }> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(options.body === undefined ? {} : { "content-type": "application/json" }), ...options.headers },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    redirect: "manual",
  });
  const text = await response.text();
  let json: unknown = undefined;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { status: response.status, json, response };
}

/** Makes a token through the session API. */
export async function makeToken(
  base: string,
  signed: Signed,
  scope: "read" | "write",
  name = `agent ${scope}`,
): Promise<{ token: string; id: string }> {
  const { status, json } = await api(base, "POST", "/api/tokens", { body: { name, scope }, headers: signed.headers });
  if (status !== 201) throw new Error(`token create answered ${status}`);
  return { token: json.token as string, id: json.info.id as string };
}
