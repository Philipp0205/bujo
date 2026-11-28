import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { demoSource } from "../src/caldav/source.ts";
import { openDb } from "../src/db.ts";
import { createCollectionStore } from "../src/log/collections.ts";
import { createEntryStore } from "../src/log/store.ts";
import { eventFieldsFor, newEventFor, newTodoFor, todoShape } from "../src/sync/mapping.ts";
import { touchesMapping } from "../src/sync/service.ts";
import { api, signUp, withApp } from "./helpers.ts";

const DAY = "2026-11-23";
const UID = "11111111-2222-4333-8444-555555555555";
const NOW = Date.UTC(2026, 10, 23, 12, 0, 0);

type Signed = { headers: Record<string, string> };

async function makeCollection(base: string, signed: Signed, name: string): Promise<string> {
  const made = await api(base, "POST", "/api/collections", { headers: signed.headers, body: { name } });
  assert.equal(made.status, 201);
  return made.json.collection.id;
}

async function addTask(base: string, signed: Signed, title: string, extra: Record<string, unknown> = {}) {
  const made = await api(base, "POST", "/api/entries", { headers: signed.headers, body: { date: DAY, type: "task", title, ...extra } });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  return made.json.entry;
}

test("a free-form note is made without a scan: several lines, kept as written, listed with the other free notes", async () => {
  await withApp(demoSource(), async ({ base }) => {
    const signed = await signUp(base);
    const body = "# Ideas\n\n- first line\n- second line\n\nlast line";
    const made = await addTask(base, signed, "Ideas", { type: "note", body });
    assert.equal(made.type, "note");
    assert.equal(made.body, body);
    assert.equal(made.collectionId, null);
    assert.equal(made.hasPhoto, false);
    await addTask(base, signed, "a short dash note", { type: "note" });

    const notes = await api(base, "GET", "/api/entries?kind=notes", { headers: signed.headers });
    assert.deepEqual(notes.json.entries.map((entry: { title: string }) => entry.title), ["Ideas"], "only the entry with a body is a free note");
    assert.equal(notes.json.entries[0].body.split("\n").length, 6);
  });
});

test("a collection is created, named once, listed with its count and refused when the name is empty", async () => {
  await withApp(demoSource(), async ({ base }) => {
    const signed = await signUp(base);
    const id = await makeCollection(base, signed, "  books   to read ");
    const again = await api(base, "POST", "/api/collections", { headers: signed.headers, body: { name: "Books to READ" } });
    assert.equal(again.status, 200, "the same name (ignoring case) answers the page that exists");
    assert.equal(again.json.collection.id, id);
    assert.equal((await api(base, "POST", "/api/collections", { headers: signed.headers, body: { name: "   " } })).status, 400);
    assert.equal((await api(base, "POST", "/api/collections", { headers: signed.headers, body: {} })).status, 400);

    const list = await api(base, "GET", "/api/collections", { headers: signed.headers });
    assert.deepEqual(list.json.collections.map((c: { name: string; count: number }) => [c.name, c.count]), [["books to read", 0]]);
    assert.equal((await api(base, "GET", "/api/collections")).status, 401);
  });
});

test("entries on a collection stay out of the day lists and are ordered on their own page", async () => {
  await withApp(demoSource(), async ({ base }) => {
    const signed = await signUp(base);
    const id = await makeCollection(base, signed, "books to read");
    await addTask(base, signed, "on the log");
    const first = await addTask(base, signed, "Dune", { collectionId: id });
    const second = await addTask(base, signed, "Emma", { collectionId: id, date: "2026-11-01" });
    assert.equal(first.collectionId, id);
    assert.equal(first.onPaper, true, "a collection entry never waits to be written on a day page");
    assert.deepEqual([first.position, second.position], [0, 1]);

    const day = await api(base, "GET", `/api/entries?from=2026-11-01&to=${DAY}`, { headers: signed.headers });
    assert.deepEqual(day.json.entries.map((entry: { title: string }) => entry.title), ["on the log"]);
    const page = await api(base, "GET", `/api/entries?collection=${id}`, { headers: signed.headers });
    assert.deepEqual(page.json.entries.map((entry: { title: string }) => entry.title), ["Dune", "Emma"]);
    assert.equal(page.json.collection.count, 2);

    const swapped = await api(base, "POST", `/api/entries/${first.id}/move`, { headers: signed.headers, body: { direction: "down" } });
    assert.deepEqual(swapped.json.entries.map((entry: { title: string }) => entry.title), ["Emma", "Dune"], "the swap works inside the page");
  });
});

test("a task is moved onto a collection and back, with the same id and its done toggle", async () => {
  await withApp(demoSource(), async ({ base }) => {
    const signed = await signUp(base);
    const id = await makeCollection(base, signed, "books to read");
    const task = await addTask(base, signed, "Moby Dick");

    const filed = await api(base, "PATCH", `/api/entries/${task.id}`, { headers: signed.headers, body: { collectionId: id } });
    assert.equal(filed.status, 200);
    assert.equal(filed.json.entry.id, task.id);
    assert.equal(filed.json.entry.collectionId, id);
    const day = await api(base, "GET", `/api/entries?from=${DAY}&to=${DAY}`, { headers: signed.headers });
    assert.equal(day.json.entries.length, 0);

    const done = await api(base, "PATCH", `/api/entries/${task.id}`, { headers: signed.headers, body: { type: "done" } });
    assert.equal(done.json.entry.type, "done");
    assert.equal(done.json.entry.collectionId, id, "a done toggle keeps the entry on its page");

    const back = await api(base, "PATCH", `/api/entries/${task.id}`, { headers: signed.headers, body: { collectionId: null, date: DAY } });
    assert.equal(back.json.entry.collectionId, null);
    const again = await api(base, "GET", `/api/entries?from=${DAY}&to=${DAY}`, { headers: signed.headers });
    assert.deepEqual(again.json.entries.map((entry: { id: string }) => entry.id), [task.id]);
    assert.equal((await api(base, "GET", `/api/entries?collection=${id}`, { headers: signed.headers })).json.entries.length, 0);
  });
});

test("an unknown, foreign or malformed collection is refused", async () => {
  await withApp(demoSource(), async ({ base }) => {
    const signed = await signUp(base);
    const missing = "3f2b8c1e-9a4d-4e7f-8b6a-1c2d3e4f5a6b";
    const body = { date: DAY, type: "task", title: "x" };
    assert.equal((await api(base, "POST", "/api/entries", { headers: signed.headers, body: { ...body, collectionId: missing } })).status, 404);
    assert.equal((await api(base, "POST", "/api/entries", { headers: signed.headers, body: { ...body, collectionId: "nope" } })).status, 400);
    assert.equal((await api(base, "GET", `/api/entries?collection=${missing}`, { headers: signed.headers })).status, 404);
    const task = await addTask(base, signed, "x");
    assert.equal((await api(base, "PATCH", `/api/entries/${task.id}`, { headers: signed.headers, body: { collectionId: missing } })).status, 404);
  });
});

// --- Rename and delete: local only. ---

test("a collection is renamed: listed under the new name, a case-only change is fine, a clash or a bad name is refused", async () => {
  await withApp(demoSource(), async ({ base }) => {
    const signed = await signUp(base);
    const id = await makeCollection(base, signed, "books");
    await makeCollection(base, signed, "films");
    const patch = (target: string, body: unknown) => api(base, "PATCH", `/api/collections/${target}`, { headers: signed.headers, body });

    const renamed = await patch(id, { name: "  Books  to read " });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.json.collection.name, "Books to read");
    assert.equal((await patch(id, { name: "BOOKS TO READ" })).json.collection.name, "BOOKS TO READ", "a case-only change of its own name is allowed");
    assert.equal((await patch(id, { name: "FILMS" })).status, 409, "another page's name is refused ignoring case");
    assert.equal((await patch(id, { name: "   " })).status, 400);
    assert.equal((await patch(id, {})).status, 400);
    assert.equal((await patch(id, { name: "x".repeat(61) })).status, 400);
    assert.equal((await patch(id, { name: "two\u0001lines" })).status, 400);
    assert.equal((await patch("3f2b8c1e-9a4d-4e7f-8b6a-1c2d3e4f5a6b", { name: "new" })).status, 404);

    const list = await api(base, "GET", "/api/collections", { headers: signed.headers });
    assert.deepEqual(list.json.collections.map((c: { name: string }) => c.name), ["BOOKS TO READ", "films"]);
  });
});

test("another user's collection can be neither renamed nor deleted (the store is scoped to one user)", async () => {
  await withApp(demoSource(), async ({ base, db }) => {
    const mine = await signUp(base);
    const id = await makeCollection(base, mine, "mine");
    const store = createCollectionStore(db);
    assert.equal(store.rename("someone-else", id, "stolen"), undefined);
    assert.equal(store.remove("someone-else", id), false);
    assert.equal((await api(base, "GET", "/api/collections", { headers: mine.headers })).json.collections[0].name, "mine");
  });
});

test("deleting a collection deletes its entries too: none goes back to a day", async () => {
  await withApp(demoSource(), async ({ base }) => {
    const signed = await signUp(base);
    const id = await makeCollection(base, signed, "books");
    await addTask(base, signed, "already here");
    const first = await addTask(base, signed, "Dune", { collectionId: id });
    await addTask(base, signed, "Emma", { collectionId: id, date: "2026-11-01", type: "note", important: true });

    const gone = await api(base, "DELETE", `/api/collections/${id}`, { headers: signed.headers });
    assert.equal(gone.status, 200);
    assert.deepEqual(gone.json, { ok: true });
    assert.deepEqual((await api(base, "GET", "/api/collections", { headers: signed.headers })).json.collections, []);
    assert.equal((await api(base, "GET", `/api/entries?collection=${id}`, { headers: signed.headers })).status, 404);

    const day = await api(base, "GET", `/api/entries?from=2026-11-01&to=${DAY}`, { headers: signed.headers });
    assert.deepEqual(day.json.entries.map((entry: { title: string }) => entry.title), ["already here"], "nothing was unfiled onto a day");
    assert.equal((await api(base, "DELETE", `/api/entries/${first.id}`, { headers: signed.headers })).status, 404, "the entry is gone");
    assert.equal((await api(base, "DELETE", `/api/collections/${id}`, { headers: signed.headers })).status, 404);
  });
});

test("an empty collection can be deleted", async () => {
  await withApp(demoSource(), async ({ base }) => {
    const signed = await signUp(base);
    const id = await makeCollection(base, signed, "empty");
    assert.equal((await api(base, "DELETE", `/api/collections/${id}`, { headers: signed.headers })).status, 200);
    assert.deepEqual((await api(base, "GET", "/api/collections", { headers: signed.headers })).json.collections, []);
  });
});

test("an older database opens with the new column and table, and its entries are on no collection", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bujo-collections-")), "old.db");
  const old = new DatabaseSync(file);
  old.exec("CREATE TABLE entries (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, date TEXT NOT NULL, time TEXT, type TEXT NOT NULL, title TEXT NOT NULL, tag TEXT, sync TEXT NOT NULL DEFAULT 'local', position INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)");
  old.exec("INSERT INTO entries (id, user_id, date, type, title, position, created_at, updated_at) VALUES ('a', 'u', '2026-11-20', 'task', 'old', 0, 1, 1)");
  old.close();
  const db = openDb(file);
  const columns = (db.prepare("PRAGMA table_info(entries)").all() as Array<{ name: string }>).map((column) => column.name);
  assert.ok(columns.includes("collection_id"));
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name = 'collections'").get());
  assert.equal(createEntryStore(db).get("u", "a")?.collectionId, null);
  db.close();
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
});

// --- CalDAV decision: collection membership is local. Nothing about a collection is written to the task list or the calendar. ---

test("a task on a collection is written exactly like a task on a day: no CATEGORIES, no DUE, nothing of the collection", () => {
  const onDay = { type: "task" as const, title: "Dune", date: DAY, horizon: "day" as const };
  const onPage = { ...onDay, collectionId: "3f2b8c1e-9a4d-4e7f-8b6a-1c2d3e4f5a6b" };
  assert.deepEqual(todoShape(onPage), todoShape(onDay));
  const ics = newTodoFor(todoShape(onPage), UID, NOW);
  assert.equal(ics, newTodoFor(todoShape(onDay), UID, NOW));
  assert.equal(/CATEGORIES/i.test(ics), false);
  assert.equal(/DUE/.test(ics), false);
});

test("filing an entry on a collection is not a change the sync target shows, so it starts no push", () => {
  assert.equal(touchesMapping({ collectionId: "3f2b8c1e-9a4d-4e7f-8b6a-1c2d3e4f5a6b" }, { type: "task" }), false);
  assert.equal(touchesMapping({ collectionId: null }, { type: "event" }), false);
  assert.equal(touchesMapping({ collectionId: null, date: DAY }, { type: "task" }), true, "the day that comes back with it is the one change a push may carry");
});

test("event categories stay the bujo category plus the entry tags, whatever collection the entry is on", () => {
  const event = { id: UID, title: "Lesen", date: DAY, time: null, tags: ["Buch"] };
  const fields = eventFieldsFor({ ...event, collectionId: "3f2b8c1e-9a4d-4e7f-8b6a-1c2d3e4f5a6b" } as typeof event);
  assert.deepEqual(fields.categories, ["bujo", "Buch"]);
  assert.equal(/books to read/i.test(newEventFor(fields, UID, NOW)), false);
});
