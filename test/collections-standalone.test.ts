import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { demoSource } from "../src/caldav/source.ts";
import { api, signUp, withApp } from "./helpers.ts";

const DAY = "2026-11-28";
// A tiny made-up JPEG: the server checks the type and the first bytes only. Never a real page photo.
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64",
);

type Headers = { cookie: string };

function note(base: string, headers: Headers, title: string, extra: Record<string, unknown> = {}) {
  return api(base, "POST", "/api/entries", { headers, body: { date: DAY, type: "note", title, ...extra } }).then((made) => {
    assert.equal(made.status, 201, JSON.stringify(made.json));
    return made.json.entry;
  });
}

async function titles(base: string, headers: Headers, query: string): Promise<string[]> {
  const list = await api(base, "GET", `/api/entries?${query}`, { headers });
  return list.json.entries.map((entry: { title: string }) => entry.title);
}

test("a free note is off the day list and in the notes list; a dash note stays on the day", async () => {
  await withApp(demoSource(), async ({ base }) => {
    const { headers } = await signUp(base);
    await note(base, headers, "Garden", { body: "# Garden\n- beds" });
    await note(base, headers, "short");
    assert.deepEqual(await titles(base, headers, `from=${DAY}&to=${DAY}`), ["short"]);
    assert.deepEqual(await titles(base, headers, "kind=notes"), ["Garden"]);
    assert.deepEqual(await titles(base, headers, `openBefore=2027-01-01`), []);
  });
});

test("an older free note (an entry with a body on a day) is detached on read: no rewrite of the row is needed", async () => {
  await withApp(demoSource(), async ({ base, db }) => {
    const { headers } = await signUp(base);
    const old = await note(base, headers, "Old note", { body: "text" });
    const before = db.prepare("SELECT date, updated_at FROM entries WHERE id = ?").get(old.id);
    assert.deepEqual(await titles(base, headers, `from=${DAY}&to=${DAY}`), []);
    assert.deepEqual(db.prepare("SELECT date, updated_at FROM entries WHERE id = ?").get(old.id), before, "the row is untouched");
  });
});

test("deleting a free note removes it and its photo from every list, and the day is unchanged", async () => {
  await withApp(demoSource(), async ({ base, db }) => {
    const { headers } = await signUp(base);
    const kept = await note(base, headers, "short");
    const made = await note(base, headers, "Garden", { body: "text" });
    const photo = await fetch(`${base}/api/entries/${made.id}/photo`, { method: "POST", headers: { "content-type": "image/jpeg", ...headers }, body: new Uint8Array(JPEG) });
    assert.equal(photo.status, 200);

    const gone = await api(base, "DELETE", `/api/entries/${made.id}`, { headers });
    assert.equal(gone.status, 200);
    assert.deepEqual(gone.json.entries.map((entry: { id: string }) => entry.id), [kept.id], "the answer is the day, without notes");
    assert.deepEqual(await titles(base, headers, "kind=notes"), []);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM entry_photos").get()!.n, 0);
    assert.equal((await fetch(`${base}/api/entries/${made.id}/photo`, { headers })).status, 404);
    assert.equal((await api(base, "DELETE", `/api/entries/${made.id}`, { headers })).status, 404);
  });
});

test("deleting a collection removes its entries, page photo rows and files, and its index listing", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bujo-standalone-"));
  try {
    await withApp(demoSource(), async ({ base, db }) => {
      const { headers } = await signUp(base);
      const made = await api(base, "POST", "/api/collections", { headers, body: { name: "Books", paperPage: 14 } });
      const id: string = made.json.collection.id;
      await note(base, headers, "Dune", { collectionId: id });
      const stored = await fetch(`${base}/api/page-photos?collection=${id}`, { method: "POST", headers: { "content-type": "image/jpeg", ...headers }, body: new Uint8Array(JPEG) });
      assert.equal(stored.status, 201);
      const photoId: string = (await stored.json()).id;
      assert.ok(fs.existsSync(path.join(dir, `${photoId}.jpg`)));
      assert.equal((await api(base, "GET", "/api/index", { headers })).json.pages.length, 1);

      assert.equal((await api(base, "DELETE", `/api/collections/${id}`, { headers })).status, 200);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM entries").get()!.n, 0, "its entries are gone");
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM page_photos").get()!.n, 0, "its photo rows are gone");
      assert.equal(fs.existsSync(path.join(dir, `${photoId}.jpg`)), false, "its photo file is gone");
      assert.equal((await fetch(`${base}/api/page-photos/${photoId}`, { headers })).status, 404);
      assert.deepEqual((await api(base, "GET", "/api/index", { headers })).json.pages, []);
      assert.deepEqual(await titles(base, headers, `from=${DAY}&to=${DAY}`), []);
    }, { photoDir: dir });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("add to index: a page number lists the collection in /api/index, clearing it removes the listing", async () => {
  await withApp(demoSource(), async ({ base }) => {
    const { headers } = await signUp(base);
    const id: string = (await api(base, "POST", "/api/collections", { headers, body: { name: "Books" } })).json.collection.id;
    assert.deepEqual((await api(base, "GET", "/api/index", { headers })).json.pages, [], "no number, not listed");

    await api(base, "PATCH", `/api/collections/${id}`, { headers, body: { paperPage: 21 } });
    const listed = (await api(base, "GET", "/api/index", { headers })).json.pages;
    assert.deepEqual(listed.map((page: { number: number; kind: string; ref: string; label: string }) => [page.number, page.kind, page.ref, page.label]), [[21, "collection", id, "Books"]]);

    await api(base, "PATCH", `/api/collections/${id}`, { headers, body: { paperPage: null } });
    assert.deepEqual((await api(base, "GET", "/api/index", { headers })).json.pages, []);
  });
});
