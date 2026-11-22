import assert from "node:assert/strict";
import test from "node:test";
import { demoSource } from "../src/caldav/source.ts";
import { createOcrClient } from "../src/scan/ocr-client.ts";
import { line, startFakeOcr } from "./fake-ocr.ts";
import { api, signUp, withApp } from "./helpers.ts";

const DAY = "2026-11-20";
const NEW = { date: DAY, type: "task", title: "Brot kaufen" };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

test("create answers onPaper false, and list, get-by-list and patch carry it; no scan columns leak", async () => {
  await withApp(demoSource(), async ({ base }) => {
    const { headers } = await signUp(base);
    const created = await api(base, "POST", "/api/entries", { body: NEW, headers });
    assert.equal(created.status, 201);
    assert.equal(created.json.entry.onPaper, false);
    const id = created.json.entry.id;
    const listed = await api(base, "GET", `/api/entries?from=${DAY}&to=${DAY}`, { headers });
    assert.equal(listed.json.entries[0].onPaper, false);
    const patched = await api(base, "PATCH", `/api/entries/${id}`, { body: { title: "Milch kaufen" }, headers });
    assert.equal(patched.json.entry.onPaper, false);
    const notes = await api(base, "GET", "/api/entries?kind=notes", { headers });
    assert.deepEqual(notes.json.entries, []);
    for (const json of [created.json, listed.json, patched.json]) {
      assert.equal(JSON.stringify(json).includes("scan"), false, "no provenance on the public API");
    }
  });
});

test("POST /:id/written puts the entry on paper without an edit; an app edit after it takes it off; written again puts it back", async () => {
  await withApp(demoSource(), async ({ base, db }) => {
    const { headers } = await signUp(base);
    const id = (await api(base, "POST", "/api/entries", { body: { ...NEW, tags: ["Haushalt"], time: "10:00" }, headers })).json.entry.id;
    const row = () => db.prepare("SELECT updated_at, sync FROM entries WHERE id = ?").get(id) as { updated_at: number; sync: string };
    const before = row();

    await sleep(5);
    const written = await api(base, "POST", `/api/entries/${id}/written`, { headers });
    assert.equal(written.status, 200);
    assert.equal(written.json.entry.onPaper, true);
    assert.equal(written.json.entry.id, id);
    assert.deepEqual(row(), before, "marking is not an edit: updated_at and sync stay");
    assert.equal(JSON.stringify(written.json).includes("scan"), false);

    await sleep(5);
    const edited = await api(base, "PATCH", `/api/entries/${id}`, { body: { time: "11:00" }, headers });
    assert.equal(edited.json.entry.onPaper, false, "an app edit of a compared field hides it again");
    const listed = await api(base, "GET", `/api/entries?from=${DAY}&to=${DAY}`, { headers });
    assert.equal(listed.json.entries[0].onPaper, false);

    await sleep(5);
    assert.equal((await api(base, "POST", `/api/entries/${id}/written`, { headers })).json.entry.onPaper, true);
    const body = await api(base, "PATCH", `/api/entries/${id}`, { body: { body: "more" }, headers });
    assert.equal(body.json.entry.onPaper, true, "body is not compared");
  });
});

test("POST /:id/written: 404 for an unknown or foreign entry, 405 for other methods, 401 without a session", async () => {
  await withApp(demoSource(), async ({ base }) => {
    assert.equal((await api(base, "POST", "/api/entries/x/written")).status, 401);
    const { headers } = await signUp(base);
    assert.equal((await api(base, "POST", "/api/entries/nope/written", { headers })).status, 404);
    const id = (await api(base, "POST", "/api/entries", { body: NEW, headers })).json.entry.id;
    assert.equal((await api(base, "GET", `/api/entries/${id}/written`, { headers })).status, 405);
    assert.equal((await api(base, "PATCH", `/api/entries/${id}/written`, { body: {}, headers })).status, 405);
  });
});

test("GET ?onPaper=0 lists only the entries not on paper in the range; other values are a 400; no flag lists all", async () => {
  await withApp(demoSource(), async ({ base }) => {
    const { headers } = await signUp(base);
    const make = async (title: string, date = DAY) => (await api(base, "POST", "/api/entries", { body: { ...NEW, title, date }, headers })).json.entry.id;
    const done = await make("schon drauf");
    await make("noch nicht");
    await make("anderer Tag", "2026-11-25");
    await api(base, "POST", `/api/entries/${done}/written`, { headers });

    const range = `from=${DAY}&to=2026-11-30`;
    const open = await api(base, "GET", `/api/entries?${range}&onPaper=0`, { headers });
    assert.deepEqual(open.json.entries.map((e: any) => [e.title, e.onPaper]), [["noch nicht", false], ["anderer Tag", false]]);
    assert.equal((await api(base, "GET", `/api/entries?${range}`, { headers })).json.entries.length, 3);
    assert.equal((await api(base, "GET", `/api/entries?${range}&onPaper=1`, { headers })).status, 400);
    assert.equal((await api(base, "GET", `/api/entries?${range}&onPaper=`, { headers })).status, 400);
    assert.equal((await api(base, "GET", `/api/entries?from=2026-01-01&to=2026-12-31&onPaper=0`, { headers })).status, 400, "the range cap still holds");
  });
});

test("a scan that matches an app-created entry leaves it on paper, and a later app edit takes it off again", async () => {
  const ocr = await startFakeOcr([]);
  try {
    await withApp(demoSource(), async ({ base }) => {
      const { headers } = await signUp(base);
      const id = (await api(base, "POST", "/api/entries", { body: NEW, headers })).json.entry.id;
      ocr.setLines([line("none", "20.11.2026"), line("•", "Brot kaufen"), line("•", "Milch")]);
      const scanned = await fetch(`${base}/api/log/scan`, { method: "POST", headers: { "content-type": "image/png", ...headers }, body: new Uint8Array(PNG) });
      const draft = (await scanned.json()).draft;
      const items = [{ id: "l2", type: "task", title: "Brot kaufen", include: false }, { id: "l3", type: "task", title: "Milch" }];
      const applied = await api(base, "POST", `/api/log/scan/${draft.id}/apply`, { body: { date: DAY, items }, headers });
      assert.equal(applied.status, 200);

      const day = (await api(base, "GET", `/api/entries?from=${DAY}&to=${DAY}`, { headers })).json.entries;
      assert.deepEqual(day.map((e: any) => [e.title, e.onPaper]), [["Brot kaufen", true], ["Milch", true]]);
      assert.equal(JSON.stringify(day).includes("scan"), false);

      await sleep(5);
      const edited = await api(base, "PATCH", `/api/entries/${id}`, { body: { tags: ["neu"] }, headers });
      assert.equal(edited.json.entry.onPaper, false, "a scan never stamps an app edit as if it were on paper");
    }, { ocr: createOcrClient(ocr.url, { timeoutMs: 1500 }) });
  } finally {
    await ocr.close();
  }
});
