import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { demoSource } from "../src/caldav/source.ts";
import { openDb, type Db } from "../src/db.ts";
import { checkPaperPage, createCollectionStore } from "../src/log/collections.ts";
import { api, signUp, withApp } from "./helpers.ts";

const USER = "user-1";

function setup(): { db: Db; store: ReturnType<typeof createCollectionStore> } {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO users (id, name, recovery_hash, created_at) VALUES (?, ?, ?, ?)").run(USER, "Tester", "hash", 1);
  return { db, store: createCollectionStore(db) };
}

test("checkPaperPage accepts null and whole numbers 1..9999, nothing else", () => {
  assert.deepEqual(checkPaperPage(null), { ok: true, value: null });
  assert.deepEqual(checkPaperPage(1), { ok: true, value: 1 });
  assert.deepEqual(checkPaperPage(9999), { ok: true, value: 9999 });
  for (const bad of [0, 10000, 1.5, "12", Number.NaN, -3, undefined, true, Infinity]) {
    const result = checkPaperPage(bad);
    assert.equal(result.ok, false, String(bad));
    if (!result.ok) assert.match(result.error, /1 to 9999/);
  }
});

test("a new collection has no page number; it can be set and cleared; an unknown id is undefined", () => {
  const { store } = setup();
  const made = store.create(USER, "books", 10);
  assert.equal(made.paperPage, null);
  assert.equal(store.setPaperPage(USER, made.id, 12)?.paperPage, 12);
  assert.equal(store.get(USER, made.id)?.paperPage, 12);
  assert.equal(store.setPaperPage(USER, made.id, null)?.paperPage, null);
  assert.equal(store.setPaperPage(USER, "nope", 3), undefined);
});

test("list reads like an index: numbered first by number (ties by creation), then the rest in creation order", () => {
  const { store } = setup();
  const a = store.create(USER, "a plain", 10);
  const b = store.create(USER, "b page 30", 20);
  const c = store.create(USER, "c page 5", 30);
  const d = store.create(USER, "d plain", 40);
  const e = store.create(USER, "e page 30", 50);
  store.setPaperPage(USER, b.id, 30);
  store.setPaperPage(USER, c.id, 5);
  store.setPaperPage(USER, e.id, 30);
  assert.deepEqual(store.list(USER).map((x) => x.name), ["c page 5", "b page 30", "e page 30", "a plain", "d plain"]);
  store.setPaperPage(USER, c.id, null);
  assert.deepEqual(store.list(USER).map((x) => x.name), ["b page 30", "e page 30", "a plain", "c page 5", "d plain"]);
  assert.ok(a && d);
});

test("another user's collection is untouched by a page number", () => {
  const { db, store } = setup();
  db.exec("DROP TRIGGER users_single_user");
  db.prepare("INSERT INTO users (id, name, recovery_hash, created_at) VALUES (?, ?, ?, ?)").run("user-2", "Other", "hash-2", 1);
  const mine = store.create(USER, "mine", 10);
  assert.equal(store.setPaperPage("user-2", mine.id, 7), undefined);
  assert.equal(store.get(USER, mine.id)?.paperPage, null);
});

test("a database made without the column gets it added on open and keeps its collections", () => {
  const dir = mkdtempSync(join(tmpdir(), "bujo-cp-"));
  const file = join(dir, "old.db");
  try {
    const old = new DatabaseSync(file);
    old.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT, email_verified_at INTEGER, recovery_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE collections (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, created_at INTEGER NOT NULL);
      INSERT INTO users VALUES ('u', 'T', NULL, NULL, 'h', 1);
      INSERT INTO collections VALUES ('c1', 'u', 'old page', 5);
    `);
    old.close();
    const db = openDb(file);
    const store = createCollectionStore(db);
    assert.deepEqual(store.list("u").map((c) => [c.name, c.paperPage]), [["old page", null]]);
    assert.equal(store.setPaperPage("u", "c1", 9)?.paperPage, 9);
    db.close();
    assert.doesNotThrow(() => openDb(file).close(), "a second open adds nothing twice");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("POST /api/collections takes an optional paperPage", async () => {
  await withApp(demoSource(), async ({ base }) => {
    const { headers } = await signUp(base);
    const plain = await api(base, "POST", "/api/collections", { headers, body: { name: "plain" } });
    assert.equal(plain.status, 201);
    assert.equal(plain.json.collection.paperPage, null);
    const paged = await api(base, "POST", "/api/collections", { headers, body: { name: "paged", paperPage: 14 } });
    assert.equal(paged.status, 201);
    assert.equal(paged.json.collection.paperPage, 14);
    const bad = await api(base, "POST", "/api/collections", { headers, body: { name: "bad", paperPage: "14" } });
    assert.equal(bad.status, 400);
    const list = await api(base, "GET", "/api/collections", { headers });
    assert.deepEqual(list.json.collections.map((c: { name: string; paperPage: number | null }) => [c.name, c.paperPage]), [["paged", 14], ["plain", null]]);
  });
});

test("PATCH /api/collections/:id sets the name and/or the page number, clears it with null, and refuses bad input", async () => {
  await withApp(demoSource(), async ({ base }) => {
    const { headers } = await signUp(base);
    const id = (await api(base, "POST", "/api/collections", { headers, body: { name: "films" } })).json.collection.id;
    await api(base, "POST", "/api/collections", { headers, body: { name: "music" } });
    const patch = (body: unknown, target = id) => api(base, "PATCH", `/api/collections/${target}`, { headers, body });

    const pageOnly = await patch({ paperPage: 20 });
    assert.equal(pageOnly.status, 200);
    assert.deepEqual([pageOnly.json.collection.name, pageOnly.json.collection.paperPage], ["films", 20]);
    const nameOnly = await patch({ name: "movies" });
    assert.deepEqual([nameOnly.json.collection.name, nameOnly.json.collection.paperPage], ["movies", 20], "a rename keeps the page number");
    const both = await patch({ name: "cinema", paperPage: 3 });
    assert.deepEqual([both.json.collection.name, both.json.collection.paperPage], ["cinema", 3]);
    const cleared = await patch({ paperPage: null });
    assert.equal(cleared.json.collection.paperPage, null);

    for (const bad of [0, 10000, 1.5, "12", -1]) {
      const refused = await patch({ paperPage: bad });
      assert.equal(refused.status, 400, String(bad));
      assert.match(refused.json.error, /paperPage/);
    }
    assert.equal((await patch({})).status, 400, "an empty body changes nothing");
    assert.equal((await patch({ paperPage: 5 }, "unknown-id")).status, 404);
    const clash = await patch({ name: "MUSIC", paperPage: 99 });
    assert.equal(clash.status, 409);
    const after = await api(base, "GET", "/api/collections", { headers });
    assert.ok(after.json.collections.every((c: { paperPage: number | null }) => c.paperPage === null), "a refused rename saves no page number");
  });
});
