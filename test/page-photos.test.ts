import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { demoSource } from "../src/caldav/source.ts";
import { openDb } from "../src/db.ts";
import { createPagePhotoStore } from "../src/log/page-photos.ts";
import { api, signUp, withApp } from "./helpers.ts";

// A tiny made-up JPEG: the server checks the type, the size and the first bytes only. Never a real page photo.
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64",
);
const DAY = "2026-11-20";
const DAY_QUERY = `kind=day&ref=${DAY}&page=1`;

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bujo-page-photos-"));
}

function post(base: string, query: string, headers: Record<string, string>, body: Buffer = JPEG, type = "image/jpeg"): Promise<Response> {
  return fetch(`${base}/api/page-photos?${query}`, { method: "POST", headers: { "content-type": type, ...headers }, body: new Uint8Array(body) });
}

/** A notebook with a stored page number for DAY, so the page is in the detail. */
async function scannedPage(base: string, headers: { cookie: string }, db: import("../src/db.ts").Db): Promise<string> {
  const notebooks = await api(base, "GET", "/api/notebooks", { headers });
  const id: string = notebooks.json.notebooks[0].id;
  const user = (db.prepare("SELECT id FROM users").get() as { id: string }).id;
  db.prepare("INSERT INTO paper_pages (user_id, kind, ref, page, number, notebook_id) VALUES (?, 'day', ?, 1, 12, ?)").run(user, DAY, id);
  return id;
}

test("an upload stores a file in the folder and a row, and GET serves it with private cache headers", async () => {
  const dir = tempDir();
  try {
    await withApp(demoSource(), async ({ base, db }) => {
      const signed = await signUp(base);
      const notebook = await scannedPage(base, signed.headers, db);
      const stored = await post(base, DAY_QUERY, signed.headers);
      assert.equal(stored.status, 201);
      const { id } = await stored.json();
      assert.deepEqual(fs.readFileSync(path.join(dir, `${id}.jpg`)), JPEG);
      const row = db.prepare("SELECT kind, ref, page, number, notebook_id, bytes FROM page_photos WHERE id = ?").get(id) as Record<string, unknown>;
      assert.deepEqual({ ...row }, { kind: "day", ref: DAY, page: 1, number: 12, notebook_id: notebook, bytes: JPEG.length });

      const served = await fetch(`${base}/api/page-photos/${id}`, { headers: signed.headers });
      assert.equal(served.status, 200);
      assert.equal(served.headers.get("content-type"), "image/jpeg");
      assert.match(served.headers.get("cache-control") ?? "", /^private/);
      assert.deepEqual(Buffer.from(await served.arrayBuffer()), JPEG);
    }, { photoDir: dir });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("another user gets 404 for a photo, and a signed-out request is 401", async () => {
  const dir = tempDir();
  try {
    await withApp(demoSource(), async ({ base, db }) => {
      const signed = await signUp(base);
      db.exec("DROP TRIGGER users_single_user");
      db.prepare("INSERT INTO users (id, name, recovery_hash, created_at) VALUES ('user-2', 'Other', 'h', 1)").run();
      const theirs = createPagePhotoStore(db, dir).add("user-2", { kind: "day", ref: DAY, page: 1 }, JPEG, 5)!;
      assert.equal((await fetch(`${base}/api/page-photos/${theirs}`, { headers: signed.headers })).status, 404);
      const mine = (await (await post(base, DAY_QUERY, signed.headers)).json()).id;
      assert.equal((await fetch(`${base}/api/page-photos/${mine}`)).status, 401);
      assert.equal((await post(base, DAY_QUERY, {})).status, 401);
      const detail = await api(base, "GET", `/api/notebooks/${(await api(base, "GET", "/api/notebooks", { headers: signed.headers })).json.notebooks[0].id}`, { headers: signed.headers });
      assert.equal(JSON.stringify(detail.json).includes(theirs), false, "another user's photo is never listed");
    }, { photoDir: dir });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the upload checks the type, the bytes and the size, and the page", async () => {
  const dir = tempDir();
  try {
    await withApp(demoSource(), async ({ base }) => {
      const signed = await signUp(base);
      assert.equal((await post(base, DAY_QUERY, signed.headers, JPEG, "image/png")).status, 415);
      assert.equal((await post(base, DAY_QUERY, signed.headers, Buffer.from("not an image"))).status, 415);
      assert.equal((await post(base, DAY_QUERY, signed.headers, Buffer.concat([JPEG.subarray(0, 4), Buffer.alloc(5 * 1024 * 1024)]))).status, 413);
      assert.equal((await post(base, "kind=nope&ref=x", signed.headers)).status, 400);
      assert.equal((await post(base, "kind=day&ref=", signed.headers)).status, 400);
      assert.equal((await post(base, "collection=missing", signed.headers)).status, 404);
      assert.equal(fs.existsSync(dir) ? fs.readdirSync(dir).length : 0, 0, "a refused upload leaves no file");
    }, { photoDir: dir });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a rescan keeps the old photo and the new one, newest first in the notebook detail", async () => {
  const dir = tempDir();
  let clock = 1000;
  try {
    await withApp(demoSource(), async ({ base, db }) => {
      const signed = await signUp(base);
      const notebook = await scannedPage(base, signed.headers, db);
      const first = (await (await post(base, DAY_QUERY, signed.headers)).json()).id;
      clock += 10;
      const second = (await (await post(base, DAY_QUERY, signed.headers, Buffer.concat([JPEG, Buffer.from([0])]))).json()).id;
      assert.notEqual(first, second);
      assert.equal(fs.readdirSync(dir).length, 2);
      const detail = await api(base, "GET", `/api/notebooks/${notebook}`, { headers: signed.headers });
      const page = detail.json.pages.find((p: { ref: string }) => p.ref === DAY);
      assert.deepEqual(page.photos.map((p: { id: string }) => p.id), [second, first]);
      assert.equal(typeof page.photos[0].createdAt, "number");
    }, { photoDir: dir, now: () => clock });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a collection page keeps photos too, and deleting the collection leaves no row", async () => {
  const dir = tempDir();
  try {
    await withApp(demoSource(), async ({ base, db }) => {
      const signed = await signUp(base);
      const made = await api(base, "POST", "/api/collections", { headers: signed.headers, body: { name: "Books" } });
      const id: string = made.json.collection.id;
      await api(base, "PATCH", `/api/collections/${id}`, { headers: signed.headers, body: { paperPage: 7 } });
      const stored = await post(base, `collection=${id}`, signed.headers);
      assert.equal(stored.status, 201);
      const row = db.prepare("SELECT kind, collection_id, number FROM page_photos").get() as Record<string, unknown>;
      assert.deepEqual({ ...row }, { kind: "collection", collection_id: id, number: 7 });
      db.prepare("DELETE FROM collections WHERE id = ?").run(id);
      assert.equal((db.prepare("SELECT COUNT(*) AS n FROM page_photos").get() as { n: number }).n, 0);
    }, { photoDir: dir });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("deleting a user removes their photo rows, and a row-less file is not served", () => {
  const dir = tempDir();
  const db = openDb(":memory:");
  try {
    db.prepare("INSERT INTO users (id, name, recovery_hash, created_at) VALUES ('u', 'P', 'h', 1)").run();
    const store = createPagePhotoStore(db, dir);
    const id = store.add("u", { kind: "month", ref: "2026-11", page: 1 }, JPEG, 2)!;
    assert.deepEqual(store.read("u", id), JPEG);
    db.prepare("DELETE FROM users WHERE id = 'u'").run();
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM page_photos").get() as { n: number }).n, 0);
    assert.equal(store.read("u", id), undefined);
    assert.equal(fs.existsSync(path.join(dir, `${id}.jpg`)), true, "the file may stay, it is just never served");
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("without a photo folder nothing is kept: POST answers 503 and no file is written", async () => {
  await withApp(demoSource(), async ({ base }) => {
    const signed = await signUp(base);
    const before = fs.readdirSync(process.cwd()).sort();
    const refused = await post(base, DAY_QUERY, signed.headers);
    assert.equal(refused.status, 503);
    assert.equal((await fetch(`${base}/api/page-photos/x`, { headers: signed.headers })).status, 404);
    assert.deepEqual(fs.readdirSync(process.cwd()).sort(), before);
  });
});
