import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { demoSource } from "../src/caldav/source.ts";
import { openDb } from "../src/db.ts";
import { createEntryStore } from "../src/log/store.ts";
import { createPhotoStore } from "../src/log/photo-store.ts";
import { api, signUp, withApp } from "./helpers.ts";

const DAY = "2026-11-20";
// A tiny JPEG, made up for the tests: the server checks the type, the size and the first bytes only.
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64",
);
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** POSTs bytes to /api/entries/:id/photo. */
function postPhoto(base: string, id: string, headers: Record<string, string>, body: Buffer = JPEG, type = "image/jpeg"): Promise<Response> {
  return fetch(`${base}/api/entries/${id}/photo`, { method: "POST", headers: { "content-type": type, ...headers }, body: new Uint8Array(body) });
}

async function newNote(base: string, headers: Record<string, string>, extra: Record<string, unknown> = {}): Promise<string> {
  const created = await api(base, "POST", "/api/entries", { headers, body: { date: DAY, type: "note", title: "Küchengarten", body: "# Küchengarten", ...extra } });
  assert.equal(created.status, 201);
  return created.json.entry.id;
}

test("a free note with a photo: the photo is stored, the list flags it, the bytes are served to the owner only", async () => {
  await withApp(demoSource(), async ({ base }) => {
    const signed = await signUp(base);
    const id = await newNote(base, signed.headers);
    const before = await api(base, "GET", `/api/entries?from=${DAY}&to=${DAY}`, { headers: signed.headers });
    assert.equal(before.json.entries[0].hasPhoto, false);

    const stored = await postPhoto(base, id, signed.headers);
    assert.equal(stored.status, 200);
    assert.equal((await stored.json()).entry.hasPhoto, true);

    const list = await api(base, "GET", `/api/entries?from=${DAY}&to=${DAY}`, { headers: signed.headers });
    assert.equal(list.json.entries[0].hasPhoto, true);
    assert.equal(JSON.stringify(list.json).includes(JPEG.toString("base64")), false, "the list never carries the bytes");

    const served = await fetch(`${base}/api/entries/${id}/photo`, { headers: signed.headers });
    assert.equal(served.status, 200);
    assert.equal(served.headers.get("content-type"), "image/jpeg");
    assert.equal(served.headers.get("cache-control"), "no-store");
    assert.deepEqual(Buffer.from(await served.arrayBuffer()), JPEG);
  });
});

test("the photo needs a session: signed out is 401 for GET and POST", async () => {
  await withApp(demoSource(), async ({ base }) => {
    const signed = await signUp(base);
    const id = await newNote(base, signed.headers);
    assert.equal((await postPhoto(base, id, signed.headers)).status, 200);
    assert.equal((await fetch(`${base}/api/entries/${id}/photo`)).status, 401);
    assert.equal((await postPhoto(base, id, {})).status, 401);
    assert.equal((await fetch(`${base}/api/entries/${id}/photo`, { headers: { cookie: "bujo_session=nope" } })).status, 401);
  });
});

test("only the owner reads or writes a photo: another user's store sees 404", () => {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO users (id, name, recovery_hash, created_at) VALUES ('u', 'P', 'h', 1)").run();
  const note = createEntryStore(db).create("u", { date: DAY, type: "note", title: "n", tags: [], time: null, body: "x" }, 1);
  const photos = createPhotoStore(db);
  assert.equal(photos.put("someone-else", note.id, { image: JPEG, contentType: "image/jpeg" }, 2), false);
  assert.equal(photos.put("u", note.id, { image: JPEG, contentType: "image/jpeg" }, 2), true);
  assert.equal(photos.get("someone-else", note.id), undefined);
  assert.deepEqual(photos.get("u", note.id)!.image, JPEG);
  db.close();
});

test("a note without a photo has hasPhoto false and its photo URL is a 404", async () => {
  await withApp(demoSource(), async ({ base }) => {
    const signed = await signUp(base);
    const id = await newNote(base, signed.headers);
    assert.equal((await api(base, "GET", `/api/entries/${id}/photo`, { headers: signed.headers })).status, 404);
    assert.equal((await api(base, "GET", "/api/entries/nope/photo", { headers: signed.headers })).status, 404);
    assert.equal((await postPhoto(base, "nope", signed.headers)).status, 404);
    const short = await api(base, "POST", "/api/entries", { headers: signed.headers, body: { date: DAY, type: "note", title: "kurz" } });
    assert.equal(short.json.entry.hasPhoto, false);
  });
});

test("the photo upload checks type, size and content; a photo can be replaced; an edit keeps it", async () => {
  await withApp(demoSource(), async ({ base }) => {
    const signed = await signUp(base);
    const id = await newNote(base, signed.headers);
    assert.equal((await postPhoto(base, id, signed.headers, PNG, "image/png")).status, 415);
    assert.equal((await postPhoto(base, id, signed.headers, Buffer.from("not an image"), "image/jpeg")).status, 415);
    assert.equal((await postPhoto(base, id, signed.headers, Buffer.alloc(0))).status, 400);
    assert.equal((await postPhoto(base, id, signed.headers, Buffer.concat([JPEG.subarray(0, 4), Buffer.alloc(15 * 1024 * 1024)]))).status, 413);
    assert.equal((await api(base, "GET", `/api/entries/${id}/photo`, { headers: signed.headers })).status, 404);

    assert.equal((await postPhoto(base, id, signed.headers)).status, 200);
    const patched = await api(base, "PATCH", `/api/entries/${id}`, { headers: signed.headers, body: { title: "Garten", body: "# neu" } });
    assert.equal(patched.json.entry.hasPhoto, true, "saving the note again without a new photo keeps the old one");
    assert.equal((await fetch(`${base}/api/entries/${id}/photo`, { headers: signed.headers })).status, 200);
    assert.equal((await api(base, "PATCH", `/api/entries/${id}`, { headers: signed.headers, body: { hasPhoto: false } })).status, 400);

    const second = Buffer.concat([JPEG, Buffer.from([0])]);
    assert.equal((await postPhoto(base, id, signed.headers, second)).status, 200);
    const served = await fetch(`${base}/api/entries/${id}/photo`, { headers: signed.headers });
    assert.deepEqual(Buffer.from(await served.arrayBuffer()), second);
    assert.equal((await api(base, "DELETE", `/api/entries/${id}/photo`, { headers: signed.headers })).status, 405);
  });
});

test("opening an older database file adds the photos table, keeps its notes, and a photo survives a reopen", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bujo-photo-migrate-"));
  const file = path.join(dir, "old.db");
  try {
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT, email_verified_at INTEGER, recovery_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE entries (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, date TEXT NOT NULL, time TEXT, type TEXT NOT NULL, title TEXT NOT NULL, tag TEXT,
        sync TEXT NOT NULL DEFAULT 'local', position INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, body TEXT);
      INSERT INTO users VALUES ('u', 'P', NULL, NULL, 'h', 1);
      INSERT INTO entries VALUES ('e1', 'u', '${DAY}', NULL, 'note', 'alt', NULL, 'local', 0, 1, 1, '# alt');`);
    old.close();
    const db = openDb(file);
    assert.equal(createEntryStore(db).get("u", "e1")!.hasPhoto, false);
    assert.equal(createPhotoStore(db).put("u", "e1", { image: JPEG, contentType: "image/jpeg" }, 2), true);
    db.close();
    const again = openDb(file);
    assert.equal(createEntryStore(again).get("u", "e1")!.hasPhoto, true);
    assert.deepEqual(createPhotoStore(again).get("u", "e1")!.image, JPEG);
    again.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
