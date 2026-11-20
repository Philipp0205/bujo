import assert from "node:assert/strict";
import test from "node:test";
import { demoSource } from "../src/caldav/source.ts";
import { api, makeToken, signUp, withApp } from "./helpers.ts";

const NEW = { date: "2026-11-20", type: "task", title: "Tasche für Stuttgart packen" };

test("/api/entries needs a browser session", async () => {
  await withApp(demoSource(), async ({ base }) => {
    const range = "?from=2026-11-14&to=2026-11-27";
    assert.equal((await api(base, "GET", `/api/entries${range}`)).status, 401);
    assert.equal((await api(base, "POST", "/api/entries", { body: NEW })).status, 401);
    assert.equal((await api(base, "PATCH", "/api/entries/x", { body: { title: "x" } })).status, 401);
    assert.equal((await api(base, "GET", `/api/entries${range}`, { headers: { cookie: "bujo_session=nope" } })).status, 401);

    const signed = await signUp(base);
    const { token } = await makeToken(base, signed, "write");
    const bearer = { authorization: `Bearer ${token}` };
    assert.equal((await api(base, "GET", `/api/entries${range}`, { headers: bearer })).status, 403);
    assert.equal((await api(base, "POST", "/api/entries", { body: NEW, headers: bearer })).status, 403);
  });
});

test("POST creates an entry with sync local, at the end of its day", async () => {
  await withApp(demoSource(), async ({ base }) => {
    const { headers } = await signUp(base);
    const first = await api(base, "POST", "/api/entries", { body: { ...NEW, title: "  eins  ", tag: " Reise " }, headers });
    assert.equal(first.status, 201);
    assert.deepEqual(
      { title: first.json.entry.title, tag: first.json.entry.tag, sync: first.json.entry.sync, position: first.json.entry.position, time: first.json.entry.time },
      { title: "eins", tag: "Reise", sync: "local", position: 0, time: null },
    );
    const second = await api(base, "POST", "/api/entries", { body: { ...NEW, type: "event", time: "13:00", title: "zwei" }, headers });
    assert.equal(second.json.entry.position, 1);
    assert.equal(second.json.entry.time, "13:00");
    assert.equal(first.json.entry.userId, undefined);
  });
});

test("GET lists a date range sorted by date then position", async () => {
  await withApp(demoSource(), async ({ base }) => {
    const { headers } = await signUp(base);
    const add = (date: string, title: string) => api(base, "POST", "/api/entries", { body: { date, type: "note", title }, headers });
    await add("2026-11-21", "c");
    await add("2026-11-20", "a");
    await add("2026-11-20", "b");
    await add("2026-12-30", "far away");
    const listed = await api(base, "GET", "/api/entries?from=2026-11-14&to=2026-11-27", { headers });
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.json.entries.map((e: { title: string }) => e.title), ["a", "b", "c"]);
    const empty = await api(base, "GET", "/api/entries?from=2026-01-01&to=2026-01-02", { headers });
    assert.deepEqual(empty.json, { entries: [] });
  });
});

test("GET refuses a missing, bad, reversed or too wide range", async () => {
  await withApp(demoSource(), async ({ base }) => {
    const { headers } = await signUp(base);
    for (const query of ["", "?from=2026-11-14", "?from=x&to=2026-11-27", "?from=2026-11-27&to=2026-11-14", "?from=2026-01-01&to=2026-04-03"]) {
      const result = await api(base, "GET", `/api/entries${query}`, { headers });
      assert.equal(result.status, 400, query);
      assert.equal(typeof result.json.error, "string");
    }
    assert.equal((await api(base, "GET", "/api/entries?from=2026-01-01&to=2026-04-02", { headers })).status, 200);
  });
});

test("PATCH edits an entry, 404 for an unknown id, and clients cannot set sync", async () => {
  await withApp(demoSource(), async ({ base }) => {
    const { headers } = await signUp(base);
    const made = (await api(base, "POST", "/api/entries", { body: { ...NEW, tag: "Reise", time: "09:00" }, headers })).json.entry;

    const edited = await api(base, "PATCH", `/api/entries/${made.id}`, {
      body: { title: " Koffer packen ", type: "done", date: "2026-11-21", time: null, tag: "" },
      headers,
    });
    assert.equal(edited.status, 200);
    assert.deepEqual(
      { title: edited.json.entry.title, type: edited.json.entry.type, date: edited.json.entry.date, time: edited.json.entry.time, tag: edited.json.entry.tag, sync: edited.json.entry.sync },
      { title: "Koffer packen", type: "done", date: "2026-11-21", time: null, tag: null, sync: "local" },
    );
    const listed = await api(base, "GET", "/api/entries?from=2026-11-20&to=2026-11-21", { headers });
    assert.equal(listed.json.entries[0].title, "Koffer packen");

    assert.equal((await api(base, "PATCH", "/api/entries/nope", { body: { title: "x" }, headers })).status, 404);
    assert.equal((await api(base, "PATCH", `/api/entries/${made.id}`, { body: { sync: "synced" }, headers })).status, 400);
    const after = await api(base, "GET", "/api/entries?from=2026-11-21&to=2026-11-21", { headers });
    assert.equal(after.json.entries[0].sync, "local");
  });
});

test("bad input is a 400 with an error message", async () => {
  await withApp(demoSource(), async ({ base }) => {
    const { headers } = await signUp(base);
    const made = (await api(base, "POST", "/api/entries", { body: NEW, headers })).json.entry;
    const badBodies: Array<Record<string, unknown>> = [
      {},
      { ...NEW, title: "   " },
      { ...NEW, title: "x".repeat(201) },
      { ...NEW, tag: "t".repeat(41) },
      { ...NEW, date: "20.11.2026" },
      { ...NEW, type: "idea" },
      { ...NEW, time: "25:61" },
      { ...NEW, sync: "synced" },
    ];
    for (const body of badBodies) {
      const result = await api(base, "POST", "/api/entries", { body, headers });
      assert.equal(result.status, 400, JSON.stringify(body));
      assert.equal(typeof result.json.error, "string");
    }
    for (const body of [{}, { title: "" }, { type: "idea" }, { date: "tomorrow" }, { time: "9" }]) {
      assert.equal((await api(base, "PATCH", `/api/entries/${made.id}`, { body, headers })).status, 400, JSON.stringify(body));
    }
    const notJson = await fetch(`${base}/api/entries`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: "{oops" });
    assert.equal(notJson.status, 400);
    assert.equal((await api(base, "DELETE", `/api/entries/${made.id}`, { headers })).status, 405);
    assert.equal((await api(base, "PUT", "/api/entries", { body: NEW, headers })).status, 405);
  });
});

test("the rapid log and the page routes: / and /backlog both need a session", async () => {
  await withApp(demoSource(), async ({ base }) => {
    const { headers } = await signUp(base);
    assert.equal((await api(base, "GET", "/backlog")).response.headers.get("location"), "/signin");
    const page = await fetch(`${base}/backlog`, { headers });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /backlog\.js/);
    const home = await fetch(`${base}/`, { headers });
    assert.match(await home.text(), /Rapid Log|js\/log/);
  });
});
