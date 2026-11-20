import assert from "node:assert/strict";
import test from "node:test";
import { createRateLimiter } from "../src/app-kit/rate-limit.ts";
import { demoSource } from "../src/caldav/source.ts";
import { api, makeToken, sessionCookieOf, signUp, withApp } from "./helpers.ts";

const json = { "content-type": "application/json" };

test("status: sign-up is open until the first account exists", async () => {
  await withApp(demoSource(), async ({ base }) => {
    assert.deepEqual((await api(base, "GET", "/api/auth/status")).json, { signupOpen: true, signedIn: false, emailEnabled: true });
    const { headers } = await signUp(base);
    assert.deepEqual((await api(base, "GET", "/api/auth/status", { headers })).json, { signupOpen: false, signedIn: true, emailEnabled: true });
  });
});

test("sign-up works once: the second one is 403, sequential or at the same time", async () => {
  await withApp(demoSource(), async ({ base, db }) => {
    const first = await api(base, "POST", "/api/auth/signup", { body: { name: "A", email: "a@example.com" } });
    assert.equal(first.status, 201);
    assert.match(first.json.recoveryCode, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const second = await api(base, "POST", "/api/auth/signup", { body: { name: "B", email: "b@example.com" } });
    assert.equal(second.status, 403);
    assert.equal(sessionCookieOf(second.response), undefined);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n, 1);
  });
  await withApp(demoSource(), async ({ base, db }) => {
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((n) => api(base, "POST", "/api/auth/signup", { body: { name: `P${n}`, email: `p${n}@example.com` } })),
    );
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    assert.equal(results.filter((r) => r.status === 403).length, 4);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n, 1);
  });
});

test("the schema itself refuses a second user, so a second process cannot sneak one in", async () => {
  await withApp(demoSource(), async ({ base, db }) => {
    await signUp(base);
    assert.throws(
      () => db.prepare("INSERT INTO users (id, name, recovery_hash, created_at) VALUES ('x', 'x', 'h', 1)").run(),
      /single user/,
    );
  });
});

test("sign-up validates the body", async () => {
  await withApp(demoSource(), async ({ base }) => {
    assert.equal((await api(base, "POST", "/api/auth/signup", { body: { name: "", email: "a@example.com" } })).status, 400);
    assert.equal((await api(base, "POST", "/api/auth/signup", { body: { name: "A", email: "not-an-email" } })).status, 400);
    assert.equal((await api(base, "POST", "/api/auth/signup", { body: { name: "A\nB", email: "a@example.com" } })).status, 400);
    assert.equal((await api(base, "POST", "/api/auth/signup", { body: { name: "x".repeat(41), email: "a@example.com" } })).status, 400);
    assert.equal((await api(base, "POST", "/api/auth/signup", { body: { email: "a@example.com" } })).status, 400);
    const bad = await fetch(`${base}/api/auth/signup`, { method: "POST", headers: json, body: "{nope" });
    assert.equal(bad.status, 400);
    // None of those created an account.
    assert.equal((await api(base, "GET", "/api/auth/status")).json.signupOpen, true);
    assert.equal((await api(base, "GET", "/api/auth/signup")).status, 405);
  });
});

test("the session cookie is HttpOnly and SameSite=Lax, and Secure only for an https origin", async () => {
  await withApp(demoSource(), async ({ base }) => {
    const response = await api(base, "POST", "/api/auth/signup", { body: { name: "A", email: "a@example.com" } });
    const cookie = response.response.headers.getSetCookie()[0];
    assert.match(cookie, /^bujo_session=[A-Za-z0-9_-]{43};/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Path=\//);
    assert.match(cookie, /Max-Age=\d+/);
    assert.doesNotMatch(cookie, /Secure/);
  });
  await withApp(
    demoSource(),
    async ({ base }) => {
      const response = await api(base, "POST", "/api/auth/signup", { body: { name: "A", email: "a@example.com" } });
      assert.match(response.response.headers.getSetCookie()[0], /; Secure/);
    },
    { origin: "https://bujo.example" },
  );
});

test("login by recovery code: any case and spacing works, a wrong code is 401", async () => {
  await withApp(demoSource(), async ({ base }) => {
    const { recoveryCode } = await signUp(base);
    const loose = recoveryCode.toLowerCase().replace(/-/g, " ");
    const ok = await api(base, "POST", "/api/auth/login", { body: { code: loose } });
    assert.equal(ok.status, 200);
    const cookie = sessionCookieOf(ok.response)!;
    assert.ok(cookie);
    assert.equal((await api(base, "GET", "/api/auth/me", { headers: { cookie } })).json.user.email, "philipp@example.com");
    assert.equal((await api(base, "POST", "/api/auth/login", { body: { code: "ABCD-EFGH-JKLM" } })).status, 401);
    assert.equal((await api(base, "POST", "/api/auth/login", { body: {} })).status, 401);
  });
});

test("login is rate limited by the kit limiter", async () => {
  await withApp(
    demoSource(),
    async ({ base }) => {
      for (let i = 0; i < 3; i++) assert.equal((await api(base, "POST", "/api/auth/login", { body: { code: "ABCD-EFGH-JKLM" } })).status, 401);
      assert.equal((await api(base, "POST", "/api/auth/login", { body: { code: "ABCD-EFGH-JKLM" } })).status, 429);
    },
    { limiter: createRateLimiter({ limit: 3, windowMs: 60_000 }) },
  );
});

test("a cookie is required: none, a made-up one and a signed-out one are all 401", async () => {
  await withApp(demoSource(), async ({ base }) => {
    const { headers, cookie } = await signUp(base);
    assert.equal((await api(base, "GET", "/api/backlog")).status, 401);
    assert.equal((await api(base, "GET", "/api/auth/me")).status, 401);
    assert.equal((await api(base, "GET", "/api/tokens")).status, 401);
    assert.equal((await api(base, "GET", "/api/backlog", { headers: { cookie: "bujo_session=nope" } })).status, 401);
    assert.equal((await api(base, "GET", "/api/backlog", { headers })).status, 200);
    const out = await api(base, "POST", "/api/auth/logout", { headers });
    assert.equal(out.status, 200);
    assert.match(out.response.headers.getSetCookie()[0], /^bujo_session=;.*Max-Age=0/);
    assert.equal((await api(base, "GET", "/api/backlog", { headers: { cookie } })).status, 401);
  });
});

test("a cross-site Origin on an unsafe cookie request is refused", async () => {
  await withApp(demoSource(), async ({ base }) => {
    const { headers } = await signUp(base);
    const evil = await api(base, "POST", "/api/auth/logout", { headers: { ...headers, origin: "https://evil.example" } });
    assert.equal(evil.status, 403);
    const same = await api(base, "POST", "/api/auth/email", { body: { email: "x@example.com" }, headers: { ...headers, origin: base } });
    assert.equal(same.status, 200);
  });
});

test("the database holds hashes only: no recovery code, session token, email token or agent token", async () => {
  await withApp(demoSource(), async ({ base, db, mailer }) => {
    const signed = await signUp(base);
    const { token } = await makeToken(base, signed, "write");
    const sessionToken = signed.cookie.split("=")[1];
    const mail = mailer.sent[0];
    const link = /#t=([A-Za-z0-9_-]+)/.exec(mail.text)![1];
    const dump = JSON.stringify([
      db.prepare("SELECT * FROM users").all(),
      db.prepare("SELECT * FROM sessions").all(),
      db.prepare("SELECT * FROM auth_links").all(),
      db.prepare("SELECT * FROM agent_tokens").all(),
    ]);
    for (const secret of [signed.recoveryCode, signed.recoveryCode.replace(/-/g, ""), sessionToken, link, token, token.slice(5)]) {
      assert.ok(!dump.includes(secret), "a secret is stored in plain text");
    }
    assert.ok(dump.includes(token.slice(0, 9)), "the display prefix is kept");
  });
});

test("verify email: the mail link carries the token in the fragment, a POST consumes it once", async () => {
  await withApp(demoSource(), async ({ base, mailer }) => {
    const { headers } = await signUp(base);
    assert.equal(mailer.sent.length, 1);
    assert.equal(mailer.sent[0].to, "philipp@example.com");
    const match = /(http:\/\/localhost)\/verify#t=([A-Za-z0-9_-]+)/.exec(mailer.sent[0].text)!;
    assert.ok(match, "link points at the configured origin");
    const token = match[2];
    // Opening the page does not use the token.
    assert.equal((await fetch(`${base}/verify`)).status, 200);
    assert.equal((await api(base, "GET", "/api/auth/me", { headers })).json.user.emailVerifiedAt, null);
    assert.equal((await api(base, "POST", "/api/auth/verify", { body: { token: "nope" } })).status, 400);
    const ok = await api(base, "POST", "/api/auth/verify", { body: { token } });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.email, "philipp@example.com");
    assert.ok(typeof (await api(base, "GET", "/api/auth/me", { headers })).json.user.emailVerifiedAt === "number");
    assert.equal((await api(base, "POST", "/api/auth/verify", { body: { token } })).status, 400, "single use");
  });
});

test("lost code: the answer is the same for any address, only a verified one gets a mail, and the link rotates the code", async () => {
  await withApp(demoSource(), async ({ base, mailer }) => {
    const { recoveryCode, headers } = await signUp(base);
    const verifyToken = /#t=([A-Za-z0-9_-]+)/.exec(mailer.sent[0].text)![1];
    const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

    // Not verified yet: no mail.
    const before = await api(base, "POST", "/api/auth/lost-code", { body: { email: "philipp@example.com" } });
    await settle();
    assert.equal(before.status, 200);
    assert.equal(mailer.sent.length, 1);

    await api(base, "POST", "/api/auth/verify", { body: { token: verifyToken } });
    const stranger = await api(base, "POST", "/api/auth/lost-code", { body: { email: "nobody@example.com" } });
    await settle();
    assert.deepEqual(stranger.json, before.json);
    assert.equal(mailer.sent.length, 1);

    const real = await api(base, "POST", "/api/auth/lost-code", { body: { email: " Philipp@Example.com " } });
    await settle();
    assert.deepEqual(real.json, before.json);
    assert.equal(mailer.sent.length, 2);
    const token = /\/recover#t=([A-Za-z0-9_-]+)/.exec(mailer.sent[1].text)![1];

    assert.equal((await fetch(`${base}/recover`)).status, 200);
    const consumed = await api(base, "POST", "/api/auth/lost-code/consume", { body: { token } });
    assert.equal(consumed.status, 200);
    assert.notEqual(consumed.json.recoveryCode, recoveryCode);
    const cookie = sessionCookieOf(consumed.response)!;
    assert.equal((await api(base, "GET", "/api/backlog", { headers: { cookie } })).status, 200);
    // The other device is signed out, the old code is dead, the new one works, the link is spent.
    assert.equal((await api(base, "GET", "/api/backlog", { headers })).status, 401);
    assert.equal((await api(base, "POST", "/api/auth/login", { body: { code: recoveryCode } })).status, 401);
    assert.equal((await api(base, "POST", "/api/auth/login", { body: { code: consumed.json.recoveryCode } })).status, 200);
    assert.equal((await api(base, "POST", "/api/auth/lost-code/consume", { body: { token } })).status, 400);
  });
});

test("lost code: a missing or malformed address is 400 and sends no mail", async () => {
  await withApp(demoSource(), async ({ base, mailer }) => {
    const { headers } = await signUp(base);
    const verifyToken = /#t=([A-Za-z0-9_-]+)/.exec(mailer.sent[0].text)![1];
    await api(base, "POST", "/api/auth/verify", { body: { token: verifyToken } });
    const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
    const before = mailer.sent.length;

    for (const email of ["", "   ", "philipp@example", "philipp@example.com."]) {
      const bad = await api(base, "POST", "/api/auth/lost-code", { body: { email } });
      assert.equal(bad.status, 400, JSON.stringify(email));
      assert.deepEqual(bad.json, { error: "enter a valid email" });
    }
    assert.equal((await api(base, "POST", "/api/auth/lost-code", { body: {} })).status, 400);
    assert.equal((await api(base, "POST", "/api/auth/lost-code", { body: { email: 5 } })).status, 400);
    await settle();
    assert.equal(mailer.sent.length, before);

    // A valid address that belongs to nobody still answers 200 and sends nothing.
    const stranger = await api(base, "POST", "/api/auth/lost-code", { body: { email: "nobody@example.com" } });
    await settle();
    assert.equal(stranger.status, 200);
    assert.deepEqual(stranger.json, { ok: true });
    assert.equal(mailer.sent.length, before);

    // The confirmed address, loosely typed, still mails.
    const real = await api(base, "POST", "/api/auth/lost-code", { body: { email: " Philipp@Example.com " } });
    await settle();
    assert.equal(real.status, 200);
    assert.equal(mailer.sent.length, before + 1);
    assert.equal(mailer.sent.at(-1)!.to, "philipp@example.com");
    assert.ok(headers.cookie);
  });
});

test("with no mailer, signup still works and email is reported as off", async () => {
  await withApp(demoSource(), async ({ base, mailer }) => {
    // startApp always passes the stub; this checks the reported flag by spelling the option out.
    assert.ok(mailer);
  });
  const { startApp } = await import("./helpers.ts");
  const app = await startApp(demoSource(), { mailer: undefined });
  try {
    const response = await api(app.base, "POST", "/api/auth/signup", { body: { name: "A", email: "a@example.com" } });
    assert.equal(response.status, 201);
    assert.equal(response.json.emailEnabled, false);
    assert.equal(app.mailer.sent.length, 0);
  } finally {
    await app.close();
  }
});

test("changing the email needs a session and invalidates the old confirmation", async () => {
  await withApp(demoSource(), async ({ base, mailer }) => {
    const { headers } = await signUp(base);
    assert.equal((await api(base, "POST", "/api/auth/email", { body: { email: "x@example.com" } })).status, 401);
    assert.equal((await api(base, "POST", "/api/auth/email", { body: { email: "nope" }, headers })).status, 400);
    const changed = await api(base, "POST", "/api/auth/email", { body: { email: "New@Example.com" }, headers });
    assert.equal(changed.status, 200);
    assert.equal(changed.json.user.email, "new@example.com");
    assert.equal(changed.json.user.emailVerifiedAt, null);
    assert.equal(mailer.sent.at(-1)!.to, "new@example.com");
  });
});
