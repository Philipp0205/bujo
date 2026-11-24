import assert from "node:assert/strict";
import test from "node:test";
import { demoSource } from "../src/caldav/source.ts";
import { createEntryStore } from "../src/log/store.ts";
import { api, makeToken, signUp, withApp } from "./helpers.ts";

const NEW = { date: "2026-11-20", type: "task", title: "Tasche für Stuttgart packen" };
const CLIENT_ID = "3f2b8c1e-9a4d-4e7f-8b6a-1c2d3e4f5a6b";

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
    const first = await api(base, "POST", "/api/entries", { body: { ...NEW, title: "  eins  ", tags: [" Reise ", "work", "reise"] }, headers });
    assert.equal(first.status, 201);
    assert.deepEqual(
      { title: first.json.entry.title, tags: first.json.entry.tags, sync: first.json.entry.sync, position: first.json.entry.position, time: first.json.entry.time },
      { title: "eins", tags: ["Reise", "work"], sync: "local", position: 0, time: null },
    );
    const second = await api(base, "POST", "/api/entries", { body: { ...NEW, type: "event", time: "13:00", title: "zwei" }, headers });
    assert.equal(second.json.entry.position, 1);
    assert.equal(second.json.entry.time, "13:00");
    assert.deepEqual(second.json.entry.tags, []);
    assert.equal(first.json.entry.userId, undefined);
  });
});

test("POST with a client id twice stores one entry with that id, and the repeat is a 200 no-op", async () => {
  await withApp(demoSource(), async ({ base }) => {
    const { headers } = await signUp(base);
    const body = { ...NEW, id: CLIENT_ID, title: "offline entry" };
    const first = await api(base, "POST", "/api/entries", { body, headers });
    assert.equal(first.status, 201);
    assert.equal(first.json.entry.id, CLIENT_ID);
    const again = await api(base, "POST", "/api/entries", { body: { ...body, title: "changed on replay" }, headers });
    assert.equal(again.status, 200);
    assert.equal(again.json.entry.id, CLIENT_ID);
    assert.equal(again.json.entry.title, "offline entry");
    const listed = await api(base, "GET", "/api/entries?from=2026-11-14&to=2026-11-27", { headers });
    assert.deepEqual(listed.json.entries.map((e: { id: string }) => e.id), [CLIENT_ID]);
  });
});

test("POST with a bad id is a 400, a missing id still gets a server id, PATCH refuses an id", async () => {
  await withApp(demoSource(), async ({ base }) => {
    const { headers } = await signUp(base);
    for (const id of ["nope", CLIENT_ID.toUpperCase(), 5, null]) {
      const bad = await api(base, "POST", "/api/entries", { body: { ...NEW, id }, headers });
      assert.equal(bad.status, 400, JSON.stringify(id));
      assert.match(bad.json.error, /^id must be a UUID/);
    }
    const minted = await api(base, "POST", "/api/entries", { body: NEW, headers });
    assert.equal(minted.status, 201);
    assert.match(minted.json.entry.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.equal((await api(base, "PATCH", `/api/entries/${minted.json.entry.id}`, { body: { id: CLIENT_ID }, headers })).status, 400);
  });
});

test("POST with an id that another user holds is a 409 and leaves that entry as it was", async () => {
  await withApp(demoSource(), async ({ base, db }) => {
    const { headers } = await signUp(base);
    // The schema allows one account (a trigger), so a second owner needs the trigger out of this throwaway database.
    db.exec("DROP TRIGGER users_single_user");
    db.prepare("INSERT INTO users (id, name, recovery_hash, created_at) VALUES (?, ?, ?, ?)").run("user-2", "Other", "hash-2", 1);
    const theirs = createEntryStore(db).create("user-2", { id: CLIENT_ID, date: "2026-11-20", type: "task", title: "theirs", tags: [], time: null }, 5);
    const clash = await api(base, "POST", "/api/entries", { body: { ...NEW, id: CLIENT_ID }, headers });
    assert.equal(clash.status, 409);
    assert.equal(clash.json.error, "that id is already in use");
    assert.deepEqual(createEntryStore(db).get("user-2", CLIENT_ID), theirs);
    const listed = await api(base, "GET", "/api/entries?from=2026-11-14&to=2026-11-27", { headers });
    assert.deepEqual(listed.json.entries, []);
  });
});

test("GET /api/tags lists each tag once with its count and last use, newest first, session only", async () => {
  await withApp(demoSource(), async ({ base }) => {
    assert.equal((await api(base, "GET", "/api/tags")).status, 401);
    const signed = await signUp(base);
    const { headers } = signed;
    assert.deepEqual((await api(base, "GET", "/api/tags", { headers })).json, { tags: [] });
    const add = (title: string, tags: string[]) => api(base, "POST", "/api/entries", { body: { ...NEW, title, tags }, headers });
    await add("a", ["Reise", "work"]);
    await add("b", ["reise"]);
    await add("c", ["Küche"]);
    const listed = await api(base, "GET", "/api/tags", { headers });
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.json.tags.map((item: { tag: string; count: number }) => [item.tag.toLowerCase(), item.count]).sort(), [["küche", 1], ["reise", 2], ["work", 1]]);
    for (const item of listed.json.tags) assert.equal(typeof item.lastUsed, "number");
    const { token } = await makeToken(base, signed, "read");
    assert.equal((await api(base, "GET", "/api/tags", { headers: { authorization: `Bearer ${token}` } })).status, 403);
  });
});

test("POST and PATCH take a horizon: month and future items sit on the last day of the month, and a day item shows in the month range with the same id", async () => {
  await withApp(demoSource(), async ({ base }) => {
    const { headers } = await signUp(base);
    const post = (body: object) => api(base, "POST", "/api/entries", { body, headers });
    const day = await post({ date: "2026-12-15", type: "task", title: "dentist" });
    assert.equal(day.json.entry.horizon, "day", "a missing horizon means day");
    const month = await post({ date: "2026-12-03", horizon: "month-task", type: "task", title: "tax return" });
    const future = await post({ date: "2027-02-10", horizon: "future", type: "event", title: "ski trip", time: "09:00" });
    assert.deepEqual([month.json.entry.date, month.json.entry.horizon, month.json.entry.position], ["2026-12-31", "month-task", 0]);
    assert.deepEqual([future.json.entry.date, future.json.entry.horizon, future.json.entry.type], ["2027-02-28", "future", "task"]);
    assert.equal((await post({ date: "2026-12-03", horizon: "someday", type: "task", title: "x" })).status, 400);

    const listed = await api(base, "GET", "/api/entries?from=2026-12-01&to=2026-12-31", { headers });
    assert.deepEqual(listed.json.entries.map((e: { id: string }) => e.id), [day.json.entry.id, month.json.entry.id]);

    const moved = await api(base, "PATCH", `/api/entries/${month.json.entry.id}`, { body: { date: "2027-01-05" }, headers });
    assert.deepEqual([moved.json.entry.date, moved.json.entry.horizon], ["2027-01-31", "month-task"]);
    const settled = await api(base, "PATCH", `/api/entries/${month.json.entry.id}`, { body: { horizon: "day", date: "2027-01-05" }, headers });
    assert.deepEqual([settled.json.entry.date, settled.json.entry.horizon], ["2027-01-05", "day"]);
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

test("GET ?kind=notes lists every free note of any day, newest first, session only", async () => {
  await withApp(demoSource(), async ({ base }) => {
    assert.equal((await api(base, "GET", "/api/entries?kind=notes")).status, 401);
    const signed = await signUp(base);
    const { headers } = signed;
    const add = (date: string, title: string, body?: string) =>
      api(base, "POST", "/api/entries", { body: { date, type: "note", title, ...(body ? { body } : {}) }, headers });
    await add("2026-01-02", "january", "# january");
    await add("2026-12-30", "december", "# december");
    await add("2026-06-01", "short line");
    await api(base, "POST", "/api/entries", { body: { ...NEW, title: "a task" }, headers });

    const listed = await api(base, "GET", "/api/entries?kind=notes", { headers });
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.json.entries.map((e: { title: string }) => e.title), ["december", "january"]);
    assert.equal(typeof listed.json.entries[0].hasPhoto, "boolean");

    assert.equal((await api(base, "GET", "/api/entries?kind=tasks", { headers })).status, 400);
    const { token } = await makeToken(base, signed, "read");
    assert.equal((await api(base, "GET", "/api/entries?kind=notes", { headers: { authorization: `Bearer ${token}` } })).status, 403);
  });
});

test("GET ?openBefore= lists open daily tasks from any earlier day, past the range cap, and refuses a bad day", async () => {
  await withApp(demoSource(), async ({ base }) => {
    assert.equal((await api(base, "GET", "/api/entries?openBefore=2026-11-20")).status, 401);
    const { headers } = await signUp(base);
    const add = (date: string, title: string, type = "task") => api(base, "POST", "/api/entries", { body: { date, type, title }, headers });
    await add("2025-03-01", "a year back");
    await add("2026-11-01", "three weeks back");
    await add("2026-11-01", "finished", "done");
    await add("2026-11-20", "today");

    const listed = await api(base, "GET", "/api/entries?openBefore=2026-11-20", { headers });
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.json.entries.map((e: { title: string }) => e.title), ["a year back", "three weeks back"]);
    assert.equal((await api(base, "GET", "/api/entries?openBefore=soon", { headers })).status, 400);
  });
});

test("GET refuses a missing, bad, reversed or too wide range", async () => {
  await withApp(demoSource(), async ({ base }) => {
    const { headers } = await signUp(base);
    for (const query of ["", "?from=2026-11-14", "?from=x&to=2026-11-27", "?from=2026-11-27&to=2026-11-14", "?from=2026-01-01&to=2026-07-20"]) {
      const result = await api(base, "GET", `/api/entries${query}`, { headers });
      assert.equal(result.status, 400, query);
      assert.equal(typeof result.json.error, "string");
    }
    assert.equal((await api(base, "GET", "/api/entries?from=2026-01-01&to=2026-07-19", { headers })).status, 200);
  });
});

test("PATCH edits an entry, 404 for an unknown id, and clients cannot set sync", async () => {
  await withApp(demoSource(), async ({ base }) => {
    const { headers } = await signUp(base);
    const made = (await api(base, "POST", "/api/entries", { body: { ...NEW, tags: ["Reise", "work"], time: "09:00" }, headers })).json.entry;

    const edited = await api(base, "PATCH", `/api/entries/${made.id}`, {
      body: { title: " Koffer packen ", type: "done", date: "2026-11-21", time: null, tags: [] },
      headers,
    });
    assert.equal(edited.status, 200);
    assert.deepEqual(
      { title: edited.json.entry.title, type: edited.json.entry.type, date: edited.json.entry.date, time: edited.json.entry.time, tags: edited.json.entry.tags, sync: edited.json.entry.sync },
      { title: "Koffer packen", type: "done", date: "2026-11-21", time: null, tags: [], sync: "local" },
    );
    const retagged = await api(base, "PATCH", `/api/entries/${made.id}`, { body: { tags: ["b", "a"] }, headers });
    assert.deepEqual(retagged.json.entry.tags, ["b", "a"], "the order is kept");
    assert.equal((await api(base, "PATCH", `/api/entries/${made.id}`, { body: { time: "10:00" }, headers })).json.entry.tags.length, 2, "an edit of another field keeps the tags");
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
      { ...NEW, tags: ["t".repeat(41)] },
      { ...NEW, tags: Array.from({ length: 11 }, (_, i) => `t${i}`) },
      { ...NEW, tags: "Reise" },
      { ...NEW, tags: null },
      { ...NEW, tag: "Reise" },
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
    for (const body of [{}, { title: "" }, { type: "idea" }, { date: "tomorrow" }, { time: "9" }, { indent: 2 }, { indent: "1" }, { tag: "Reise" }, { tags: "Reise" }, { tags: [1] }]) {
      assert.equal((await api(base, "PATCH", `/api/entries/${made.id}`, { body, headers })).status, 400, JSON.stringify(body));
    }
    assert.equal((await api(base, "POST", "/api/entries", { body: { ...NEW, indent: 1 }, headers })).status, 400);
    const notJson = await fetch(`${base}/api/entries`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: "{oops" });
    assert.equal(notJson.status, 400);
    assert.equal((await api(base, "PUT", `/api/entries/${made.id}`, { body: NEW, headers })).status, 405);
    assert.equal((await api(base, "PUT", "/api/entries", { body: NEW, headers })).status, 405);
  });
});

test("DELETE removes the entry from the log and answers what is left of its day", async () => {
  await withApp(demoSource(), async ({ base }) => {
    const { headers } = await signUp(base);
    const add = async (title: string) => (await api(base, "POST", "/api/entries", { body: { ...NEW, title }, headers })).json.entry;
    const a = await add("a");
    const b = await add("b");
    const removed = await api(base, "DELETE", `/api/entries/${a.id}`, { headers });
    assert.equal(removed.status, 200);
    assert.deepEqual(removed.json.entries.map((e: { title: string; position: number }) => [e.title, e.position]), [["b", 0]]);
    assert.equal((await api(base, "DELETE", `/api/entries/${a.id}`, { headers })).status, 404);
    assert.equal((await api(base, "DELETE", `/api/entries/${b.id}`, {})).status, 401);
    const listed = await api(base, "GET", "/api/entries?from=2026-11-20&to=2026-11-20", { headers });
    assert.equal(listed.json.entries.length, 1);
  });
});

test("POST /move swaps with the neighbour and answers the day in its new order", async () => {
  await withApp(demoSource(), async ({ base }) => {
    const { headers } = await signUp(base);
    const add = async (title: string) => (await api(base, "POST", "/api/entries", { body: { ...NEW, title }, headers })).json.entry;
    const a = await add("a");
    await add("b");
    const moved = await api(base, "POST", `/api/entries/${a.id}/move`, { body: { direction: "down" }, headers });
    assert.equal(moved.status, 200);
    assert.deepEqual(moved.json.entries.map((e: { title: string }) => e.title), ["b", "a"]);
    assert.equal((await api(base, "POST", `/api/entries/${a.id}/move`, { body: { direction: "sideways" }, headers })).status, 400);
    assert.equal((await api(base, "POST", "/api/entries/nope/move", { body: { direction: "up" }, headers })).status, 404);
    assert.equal((await api(base, "POST", `/api/entries/${a.id}/move`, { body: { direction: "up" } })).status, 401);
  });
});

test("PATCH indent nests an entry under the one above and clears itself for the first", async () => {
  await withApp(demoSource(), async ({ base }) => {
    const { headers } = await signUp(base);
    const add = async (title: string) => (await api(base, "POST", "/api/entries", { body: { ...NEW, title }, headers })).json.entry;
    const a = await add("a");
    const b = await add("b");
    assert.equal((await api(base, "PATCH", `/api/entries/${a.id}`, { body: { indent: 1 }, headers })).json.entry.indent, 0);
    assert.equal((await api(base, "PATCH", `/api/entries/${b.id}`, { body: { indent: 1 }, headers })).json.entry.indent, 1);
    assert.equal((await api(base, "PATCH", `/api/entries/${b.id}`, { body: { indent: 0 }, headers })).json.entry.indent, 0);
  });
});

test("important is a plain boolean: off by default, set on create or PATCH, and anything else is a 400", async () => {
  await withApp(demoSource(), async ({ base }) => {
    const { headers } = await signUp(base);
    const plain = (await api(base, "POST", "/api/entries", { body: NEW, headers })).json.entry;
    assert.equal(plain.important, false);
    const starred = (await api(base, "POST", "/api/entries", { body: { ...NEW, important: true }, headers })).json.entry;
    assert.equal(starred.important, true);
    const on = await api(base, "PATCH", `/api/entries/${plain.id}`, { body: { important: true }, headers });
    assert.deepEqual([on.json.entry.important, on.json.entry.title], [true, NEW.title]);
    const off = await api(base, "PATCH", `/api/entries/${plain.id}`, { body: { important: false }, headers });
    assert.equal(off.json.entry.important, false);
    assert.equal((await api(base, "PATCH", `/api/entries/${plain.id}`, { body: { important: "yes" }, headers })).status, 400);
  });
});

test("the daily log and the page routes: / and /backlog both need a session", async () => {
  await withApp(demoSource(), async ({ base }) => {
    const { headers } = await signUp(base);
    assert.equal((await api(base, "GET", "/backlog")).response.headers.get("location"), "/signin");
    const page = await fetch(`${base}/backlog`, { headers });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /backlog\.js/);
    const home = await fetch(`${base}/`, { headers });
    assert.match(await home.text(), /Daily Log|js\/log/);
  });
});
