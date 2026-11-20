import assert from "node:assert/strict";
import test from "node:test";
import { loadCalDavConfig } from "../src/caldav/config.ts";
import { caldavSource, demoSource } from "../src/caldav/source.ts";
import { fakeEnv, PASSWORD, startFakeCalDav } from "./fake-caldav.ts";
import { api, signUp, withApp } from "./helpers.ts";

test("GET /healthz answers ok without signing in", async () => {
  await withApp(demoSource(), async ({ base }) => {
    const response = await fetch(`${base}/healthz`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal((await fetch(`${base}/healthz`, { method: "POST" })).status, 405);
  });
});

test("GET /api/backlog needs a session", async () => {
  await withApp(demoSource(), async ({ base }) => {
    assert.equal((await api(base, "GET", "/api/backlog")).status, 401);
    assert.equal((await api(base, "GET", "/api/backlog", { headers: { cookie: "bujo_session=not-a-session" } })).status, 401);
  });
});

test("GET /api/backlog serves the demo source with open items only", async () => {
  await withApp(demoSource(), async ({ base }) => {
    const { headers } = await signUp(base);
    const response = await fetch(`${base}/api/backlog`, { headers });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { source: string; lists: string[]; tasks: Array<{ status: string; list: string }> };
    assert.equal(body.source, "demo");
    assert.deepEqual(body.lists, ["Aufgaben", "Arbeit"]);
    assert.ok(body.tasks.length > 0);
    assert.ok(body.tasks.every((task) => task.status === "NEEDS-ACTION" || task.status === "IN-PROCESS"));
    const all = (await (await fetch(`${base}/api/backlog?status=all`, { headers })).json()) as { tasks: unknown[] };
    assert.ok(all.tasks.length > body.tasks.length);
  });
});

test("GET /api/backlog reads the fake CalDAV server and hides a failure's details", async () => {
  const fake = await startFakeCalDav();
  try {
    await withApp(caldavSource(loadCalDavConfig(fakeEnv(fake))!), async ({ base }) => {
      const { headers } = await signUp(base);
      const body = (await (await fetch(`${base}/api/backlog`, { headers })).json()) as { source: string; tasks: Array<{ uid: string }> };
      assert.equal(body.source, "caldav");
      assert.equal(body.tasks.length, 6);
      assert.ok(fake.requests.every((request) => request.method === "REPORT"));
      // The backlog route itself only reads.
      assert.equal((await fetch(`${base}/api/backlog`, { method: "PUT", body: "{}", headers })).status, 405);
      assert.equal((await fetch(`${base}/api/backlog`, { method: "DELETE", headers })).status, 405);
    });
    assert.ok(fake.requests.every((request) => request.method === "PROPFIND" || request.method === "REPORT"));
  } finally {
    await fake.close();
  }

  const refusing = await startFakeCalDav({ auth: { user: "someone-else", password: PASSWORD } });
  try {
    await withApp(caldavSource(loadCalDavConfig(fakeEnv(refusing))!), async ({ base }) => {
      const { headers } = await signUp(base);
      const response = await fetch(`${base}/api/backlog`, { headers });
      assert.equal(response.status, 502);
      const text = await response.text();
      assert.ok(!text.includes(refusing.base) && !text.includes(PASSWORD));
    });
  } finally {
    await refusing.close();
  }
});

test("pages: signed out goes to sign-up first, then sign-in; signed in gets the app", async () => {
  await withApp(demoSource(), async ({ base }) => {
    const first = await api(base, "GET", "/");
    assert.equal(first.status, 302);
    assert.equal(first.response.headers.get("location"), "/signup");
    assert.equal(first.response.headers.get("cache-control"), "no-store");
    assert.equal((await api(base, "GET", "/signin")).response.headers.get("location"), "/signup");
    assert.equal((await fetch(`${base}/signup`)).status, 200);

    const { headers } = await signUp(base);
    const signedOut = await api(base, "GET", "/");
    assert.equal(signedOut.response.headers.get("location"), "/signin");
    assert.equal((await api(base, "GET", "/settings")).response.headers.get("location"), "/signin");
    assert.equal((await api(base, "GET", "/signup")).response.headers.get("location"), "/signin");
    assert.equal((await fetch(`${base}/signin`)).status, 200);
    assert.equal((await fetch(`${base}/lost`)).status, 200);
    assert.equal((await fetch(`${base}/verify`)).status, 200);
    assert.equal((await fetch(`${base}/recover`)).status, 200);

    const page = await fetch(`${base}/`, { headers });
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type") ?? "", /text\/html/);
    assert.match(page.headers.get("content-security-policy") ?? "", /default-src 'self'/);
    assert.match(await page.text(), /Backlog|bujo/);
    assert.equal((await fetch(`${base}/settings`, { headers })).status, 200);
    // A signed-in person is sent away from the sign-in pages.
    assert.equal((await api(base, "GET", "/signin", { headers })).response.headers.get("location"), "/");
  });
});

test("static files: the kit, the manifest and a 404 for a missing file", async () => {
  await withApp(demoSource(), async ({ base }) => {
    assert.equal((await fetch(`${base}/app-kit/ak-tokens.css`)).status, 200);
    const manifest = await fetch(`${base}/manifest.webmanifest?v=1`);
    assert.equal(manifest.status, 200);
    assert.match(manifest.headers.get("content-type") ?? "", /manifest\+json/);
    assert.equal((await fetch(`${base}/nope.js`)).status, 404);
    assert.equal((await fetch(`${base}/nope`)).status, 404);
    assert.equal((await fetch(`${base}/api/nope`)).status, 404);
  });
});
