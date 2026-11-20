import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createApp } from "../src/app.ts";
import { loadCalDavConfig } from "../src/caldav/config.ts";
import { caldavSource, demoSource } from "../src/caldav/source.ts";
import { fakeEnv, PASSWORD, startFakeCalDav } from "./fake-caldav.ts";

async function withApp(source: Parameters<typeof createApp>[0]["source"], fn: (base: string) => Promise<void>) {
  const server = http.createServer(createApp({ source }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("GET /healthz answers ok", async () => {
  await withApp(demoSource(), async (base) => {
    const response = await fetch(`${base}/healthz`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal((await fetch(`${base}/healthz`, { method: "POST" })).status, 405);
  });
});

test("GET /api/backlog serves the demo source with open items only", async () => {
  await withApp(demoSource(), async (base) => {
    const response = await fetch(`${base}/api/backlog`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { source: string; lists: string[]; tasks: Array<{ status: string; list: string }> };
    assert.equal(body.source, "demo");
    assert.deepEqual(body.lists, ["Aufgaben", "Arbeit"]);
    assert.ok(body.tasks.length > 0);
    assert.ok(body.tasks.every((task) => task.status === "NEEDS-ACTION" || task.status === "IN-PROCESS"));
    const all = (await (await fetch(`${base}/api/backlog?status=all`)).json()) as { tasks: unknown[] };
    assert.ok(all.tasks.length > body.tasks.length);
  });
});

test("GET /api/backlog reads the fake CalDAV server, never writes, and hides a failure's details", async () => {
  const fake = await startFakeCalDav();
  try {
    await withApp(caldavSource(loadCalDavConfig(fakeEnv(fake))!), async (base) => {
      const body = (await (await fetch(`${base}/api/backlog`)).json()) as { source: string; tasks: Array<{ uid: string }> };
      assert.equal(body.source, "caldav");
      assert.equal(body.tasks.length, 6);
      assert.ok(fake.requests.every((request) => request.method === "REPORT"));
      // Writes through the app are not routes.
      assert.equal((await fetch(`${base}/api/backlog`, { method: "PUT", body: "{}" })).status, 405);
      assert.equal((await fetch(`${base}/api/backlog`, { method: "DELETE" })).status, 405);
    });
    assert.ok(fake.requests.every((request) => request.method === "PROPFIND" || request.method === "REPORT"));
  } finally {
    await fake.close();
  }

  const refusing = await startFakeCalDav({ auth: { user: "someone-else", password: PASSWORD } });
  try {
    await withApp(caldavSource(loadCalDavConfig(fakeEnv(refusing))!), async (base) => {
      const response = await fetch(`${base}/api/backlog`);
      assert.equal(response.status, 502);
      const text = await response.text();
      assert.ok(!text.includes(refusing.base) && !text.includes(PASSWORD));
    });
  } finally {
    await refusing.close();
  }
});

test("static files: the page, the kit, the manifest and a 404 for a missing file", async () => {
  await withApp(demoSource(), async (base) => {
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type") ?? "", /text\/html/);
    assert.match(page.headers.get("content-security-policy") ?? "", /default-src 'self'/);
    assert.match(await page.text(), /Backlog|bujo/);
    assert.equal((await fetch(`${base}/app-kit/ak-tokens.css`)).status, 200);
    const manifest = await fetch(`${base}/manifest.webmanifest?v=1`);
    assert.equal(manifest.status, 200);
    assert.match(manifest.headers.get("content-type") ?? "", /manifest\+json/);
    assert.equal((await fetch(`${base}/nope.js`)).status, 404);
    assert.equal((await fetch(`${base}/api/nope`)).status, 404);
  });
});
