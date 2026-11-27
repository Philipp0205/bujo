import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { demoSource } from "../src/caldav/source.ts";
import { openDb, type Db } from "../src/db.ts";
import { createNotebookStore } from "../src/log/notebooks.ts";
import { createPaperPageStore } from "../src/log/paper-pages.ts";
import { pageStatus } from "../src/log/notebook-pages.ts";
import { api, signUp, withApp } from "./helpers.ts";

const NOON = Date.parse("2026-11-20T12:00:00Z");

/** A scratch database file, removed after fn. */
function withFile(fn: (file: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bujo-notebooks-"));
  try {
    fn(path.join(dir, "old.db"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function addUser(db: Db): void {
  db.prepare("INSERT INTO users (id, name, recovery_hash, created_at) VALUES ('u1', 'P', 'x', 0)").run();
}

test("pageStatus marks numbers 1..pageCount scanned or not, first item of a number wins, higher numbers are left out", () => {
  const pages = [
    { number: 3, kind: "day", ref: "2026-11-18" },
    { number: 3, kind: "month", ref: "2026-11" },
    { number: 9, kind: "future", ref: "2027-01" },
    { number: 50, kind: "day", ref: "2026-12-01" },
  ];
  const status = pageStatus(pages, 5);
  assert.deepEqual(status.map((s) => [s.number, s.scanned]), [[1, false], [2, false], [3, true], [4, false], [5, false]]);
  assert.equal(status[2].item, pages[0]);
  assert.equal(status[0].item, undefined);
  assert.deepEqual(pageStatus([], 0), []);
  assert.equal(pageStatus(pages, 9)[8].scanned, true);
});

test("store: a user with none gets Notebook 1 on first use, and startNew ends the open one today", () => {
  const db = openDb(":memory:");
  addUser(db);
  const store = createNotebookStore(db);
  const first = store.active("u1", NOON);
  assert.equal(first.name, "Notebook 1");
  assert.equal(first.pageCount, 100);
  assert.equal(first.startedOn, "2026-11-20");
  assert.equal(first.endedOn, null);
  assert.equal(store.active("u1", NOON).id, first.id, "asking again makes no second notebook");
  const next = store.startNew("u1", { name: "Dotted A5", pageCount: 120 }, NOON + 5 * 86_400_000);
  const list = store.list("u1", NOON);
  assert.deepEqual(list.map((n) => [n.name, n.active, n.endedOn]), [["Dotted A5", true, null], ["Notebook 1", false, "2026-11-25"]]);
  assert.equal(next.startedOn, "2026-11-25");
  assert.equal(store.active("u1", NOON).id, next.id);
  db.close();
});

test("store: update renames and resizes, never below the highest page number of that notebook", () => {
  const db = openDb(":memory:");
  addUser(db);
  const store = createNotebookStore(db);
  const book = store.active("u1", NOON);
  db.prepare("INSERT INTO paper_pages (user_id, kind, ref, page, number, notebook_id) VALUES ('u1', 'day', '2026-11-18', 1, 40, ?)").run(book.id);
  assert.equal(store.highestPage("u1", book.id), 40);
  assert.equal(store.update("u1", book.id, { pageCount: 39 }), "too-small");
  assert.equal((store.update("u1", book.id, { pageCount: 40, name: "Renamed" }) as { pageCount: number }).pageCount, 40);
  assert.equal(store.get("u1", book.id)?.name, "Renamed");
  assert.equal(store.update("u1", "nope", { name: "x" }), undefined);
  db.close();
});

test("migration: existing scans, collections and free notes land in the first notebook, and a second open changes nothing", () => {
  withFile((file) => {
    const old = openDb(file);
    addUser(old);
    old.prepare("INSERT INTO entries (id, user_id, date, type, title, position, created_at, updated_at, body) VALUES ('e1', 'u1', '2026-10-02', 'note', 'Trip', 0, 1, 1, 'text')").run();
    old.prepare("INSERT INTO entries (id, user_id, date, type, title, position, created_at, updated_at) VALUES ('e2', 'u1', '2026-11-01', 'task', 'plain', 0, 1, 1)").run();
    old.prepare("INSERT INTO paper_pages (user_id, kind, ref, page, number) VALUES ('u1', 'day', '2026-11-18', 1, 104)").run();
    old.prepare("INSERT INTO collections (id, user_id, name, created_at, paper_page) VALUES ('c1', 'u1', 'Books', 1, 7)").run();
    // Back to a database from before notebooks: no notebooks, no flag, no notebook ids.
    old.exec("DELETE FROM notebooks; DELETE FROM migrations WHERE name = 'notebooks-v1'; UPDATE paper_pages SET notebook_id = NULL; UPDATE collections SET notebook_id = NULL; UPDATE entries SET notebook_id = NULL");
    old.close();

    const once = openDb(file);
    const books = once.prepare("SELECT * FROM notebooks").all() as Array<Record<string, unknown>>;
    assert.equal(books.length, 1);
    assert.equal(books[0].name, "Notebook 1");
    assert.equal(books[0].started_on, "2026-10-02", "starts at the earliest entry");
    assert.equal(books[0].page_count, 110, "highest page 104 rounded up to ten");
    assert.equal(books[0].ended_on, null);
    const id = books[0].id;
    assert.equal((once.prepare("SELECT notebook_id AS n FROM paper_pages").get() as { n: string }).n, id);
    assert.equal((once.prepare("SELECT notebook_id AS n FROM collections").get() as { n: string }).n, id);
    assert.equal((once.prepare("SELECT notebook_id AS n FROM entries WHERE id = 'e1'").get() as { n: string }).n, id);
    assert.equal((once.prepare("SELECT notebook_id AS n FROM entries WHERE id = 'e2'").get() as { n: string | null }).n, null, "a log entry is not a free note");
    const before = JSON.stringify([once.prepare("SELECT * FROM notebooks").all(), once.prepare("SELECT * FROM paper_pages").all(), once.prepare("SELECT id, notebook_id FROM entries ORDER BY id").all()]);
    once.close();

    const twice = openDb(file);
    const after = JSON.stringify([twice.prepare("SELECT * FROM notebooks").all(), twice.prepare("SELECT * FROM paper_pages").all(), twice.prepare("SELECT id, notebook_id FROM entries ORDER BY id").all()]);
    assert.equal(after, before);
    twice.close();
  });
});

test("migration: an empty database gets no notebook until a user needs one", () => {
  const db = openDb(":memory:");
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM notebooks").get() as { n: number }).n, 0);
  db.close();
});

test("routes: list, start a new notebook, patch, validation, detail", async () => {
  await withApp(demoSource(), async (app) => {
    const { headers } = await signUp(app.base);
    const call = (method: string, url: string, body?: unknown) => api(app.base, method, url, { body, headers });
    const first = (await call("GET", "/api/notebooks")).json.notebooks;
    assert.equal(first.length, 1);
    assert.equal(first[0].active, true);

    const made = await call("POST", "/api/notebooks", { name: "  Dotted   A5 ", pageCount: 80 });
    assert.equal(made.status, 201);
    assert.equal(made.json.notebook.name, "Dotted A5");
    assert.equal(made.json.notebook.active, true);
    const list = (await call("GET", "/api/notebooks")).json.notebooks;
    assert.deepEqual(list.map((n: any) => [n.name, n.active]), [["Dotted A5", true], ["Notebook 1", false]]);
    assert.ok(list[1].endedOn, "the previous notebook has an end date");

    for (const bad of [{ name: "", pageCount: 10 }, { name: "x", pageCount: 0 }, { name: "x", pageCount: 10000 }, { name: "x", pageCount: "10" }, { pageCount: 10 }, { name: "x" }]) {
      assert.equal((await call("POST", "/api/notebooks", bad)).status, 400, JSON.stringify(bad));
    }
    assert.equal((await call("GET", "/api/notebooks")).json.notebooks.length, 2, "a refused start changes nothing");

    const id = made.json.notebook.id;
    assert.equal((await call("PATCH", `/api/notebooks/${id}`, {})).status, 400);
    assert.equal((await call("PATCH", `/api/notebooks/${id}`, { name: "  " })).status, 400);
    assert.equal((await call("PATCH", "/api/notebooks/nope", { name: "x" })).status, 404);
    assert.equal((await call("PATCH", `/api/notebooks/${id}`, { name: "Renamed", pageCount: 90 })).json.notebook.pageCount, 90);
    assert.equal((await call("DELETE", `/api/notebooks/${id}`)).status, 405);
    assert.equal((await api(app.base, "GET", "/api/notebooks")).status, 401);
  });
});

test("routes: new collections, free notes and page numbers go to the active notebook, and detail shows only that notebook", async () => {
  await withApp(demoSource(), async (app) => {
    const { headers } = await signUp(app.base);
    const call = (method: string, url: string, body?: unknown) => api(app.base, method, url, { body, headers });
    const oldBook = (await call("GET", "/api/notebooks")).json.notebooks[0];
    await call("POST", "/api/collections", { name: "Books", paperPage: 12 });
    await call("POST", "/api/entries", { date: "2026-11-18", type: "note", title: "Trip", body: "Plan" });
    await call("POST", "/api/entries", { date: "2026-11-18", type: "task", title: "plain task" });
    const userId = (app.db.prepare("SELECT id FROM users").get() as { id: string }).id;
    app.db.prepare("INSERT INTO paper_pages (user_id, kind, ref, page, number, notebook_id) VALUES (?, 'day', '2026-11-18', 1, 5, ?)").run(userId, oldBook.id);

    const newBook = (await call("POST", "/api/notebooks", { name: "Second", pageCount: 50 })).json.notebook;
    await call("POST", "/api/collections", { name: "Garden", paperPage: 3 });
    await call("POST", "/api/entries", { date: "2026-11-21", type: "note", title: "Beds", body: "Herbs" });

    const oldDetail = (await call("GET", `/api/notebooks/${oldBook.id}`)).json;
    assert.deepEqual(oldDetail.pages.map((p: any) => [p.number, p.kind]), [[5, "day"], [12, "collection"]]);
    assert.deepEqual(oldDetail.collections.map((c: any) => c.name), ["Books"]);
    assert.deepEqual(oldDetail.notes.map((n: any) => n.title), ["Trip"]);
    assert.equal(oldDetail.notebook.id, oldBook.id);

    const newDetail = (await call("GET", `/api/notebooks/${newBook.id}`)).json;
    assert.deepEqual(newDetail.pages.map((p: any) => [p.number, p.kind]), [[3, "collection"]]);
    assert.deepEqual(newDetail.notes.map((n: any) => n.title), ["Beds"]);
    assert.equal((await call("GET", "/api/notebooks/nope")).status, 404);

    // GET /api/index still lists every notebook.
    assert.equal((await call("GET", "/api/index")).json.pages.length, 3);
    // The old notebook cannot shrink below its highest page.
    assert.equal((await call("PATCH", `/api/notebooks/${oldBook.id}`, { pageCount: 11 })).status, 400);
    assert.equal((await call("PATCH", `/api/notebooks/${oldBook.id}`, { pageCount: 12 })).status, 200);

    // The list carries each notebook's scanned count: the same pages the detail shows (a scan and a numbered collection).
    const counts = (await call("GET", "/api/notebooks")).json.notebooks.map((n: any) => [n.name, n.scannedCount]);
    assert.deepEqual(counts, [["Second", 1], ["Notebook 1", 2]]);
  });
});

test("a rescan of a page files its number in the active notebook", () => {
  const db = openDb(":memory:");
  addUser(db);
  const store = createNotebookStore(db);
  const pages = createPaperPageStore(db);
  const first = store.active("u1", NOON);
  pages.save("u1", "day", "2026-11-18", 1, 4, NOON);
  assert.equal(pages.list("u1", first.id).length, 1);
  const second = store.startNew("u1", { name: "Two", pageCount: 60 }, NOON);
  pages.save("u1", "day", "2026-11-18", 1, 7, NOON);
  assert.deepEqual(pages.list("u1", first.id), []);
  assert.deepEqual(pages.list("u1", second.id), [{ kind: "day", ref: "2026-11-18", page: 1, number: 7 }]);
  db.close();
});
