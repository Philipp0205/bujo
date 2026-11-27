import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { demoSource } from "../src/caldav/source.ts";
import { openDb } from "../src/db.ts";
import { createOcrClient } from "../src/scan/ocr-client.ts";
import { line, startFakeOcr, type FakeOcr } from "./fake-ocr.ts";
import { api, signUp, withApp, type Signed, type TestApp } from "./helpers.ts";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const DAY = "2026-11-18";

type Ctx = { base: string; ocr: FakeOcr; signed: Signed; app: TestApp };

/** The app with the demo source (no CalDAV) and the fake OCR. Nothing here reaches a real list. */
async function withScan(fn: (ctx: Ctx) => Promise<void>): Promise<void> {
  const ocr = await startFakeOcr([]);
  try {
    await withApp(demoSource(), async (app) => fn({ app, base: app.base, ocr, signed: await signUp(app.base) }), { ocr: createOcrClient(ocr.url, { timeoutMs: 1500 }) });
  } finally {
    await ocr.close();
  }
}

/** Scans two bullet lines (a fresh draft each time) with the OCR reading `number` as the page number (undefined: key left out). */
async function scan(ctx: Ctx, number: unknown, titles = ["Alpha", "Bravo"]) {
  ctx.ocr.setLines(titles.map((title) => line("•", title)));
  ctx.ocr.setPageNumber(number);
  const response = await fetch(`${ctx.base}/api/log/scan`, { method: "POST", headers: { "content-type": "image/png", ...ctx.signed.headers }, body: new Uint8Array(PNG) });
  return (await response.json()).draft;
}

const items = (review: any) => review.items.map((i: any) => ({ id: i.id, type: "task", title: i.title }));
const apply = (ctx: Ctx, review: any, body: Record<string, unknown>) => api(ctx.base, "POST", `/api/log/scan/${review.id}/apply`, { body: { ...body, items: items(review) }, headers: ctx.signed.headers });
const index = async (ctx: Ctx) => (await api(ctx.base, "GET", "/api/index", { headers: ctx.signed.headers })).json.pages;

test("ocr client: pageNumber is optional and anything but an integer 1..9999 is null", async () => {
  const cases: Array<[unknown, number | null]> = [[12, 12], [1, 1], [9999, 9999], [0, null], [10000, null], [-4, null], [1.5, null], ["12", null], [true, null], [null, null]];
  for (const [sent, want] of cases) {
    const ocr = await startFakeOcr([line("•", "x")]);
    try {
      ocr.setPageNumber(sent);
      assert.equal((await createOcrClient(ocr.url)(PNG, "image/png")).pageNumber, want, `sent ${JSON.stringify(sent)}`);
    } finally {
      await ocr.close();
    }
  }
  const plain = await startFakeOcr([line("•", "x")]);
  try {
    assert.equal((await createOcrClient(plain.url)(PNG, "image/png")).pageNumber, null, "an answer without it is valid");
  } finally {
    await plain.close();
  }
});

test("the review starts with the number the OCR read, and switching the kind keeps it", async () => {
  await withScan(async (ctx) => {
    const review = await scan(ctx, 12);
    assert.equal(review.paperNumber, 12);
    const switched = await api(ctx.base, "POST", `/api/log/scan/${review.id}/kind`, { body: { kind: "future" }, headers: ctx.signed.headers });
    assert.equal(switched.json.draft.paperNumber, 12);
    assert.equal((await scan(ctx, undefined)).paperNumber, null);
    assert.equal((await scan(ctx, 0)).paperNumber, null);
  });
});

test("check and apply take paperNumber: absent, null and 1..9999 pass, anything else is a 400 that writes nothing", async () => {
  await withScan(async (ctx) => {
    const review = await scan(ctx, null);
    const check = (paperNumber: unknown) => api(ctx.base, "POST", `/api/log/scan/${review.id}/check`, { body: { date: DAY, items: items(review), ...(paperNumber === undefined ? {} : { paperNumber }) }, headers: ctx.signed.headers });
    for (const ok of [undefined, null, 12, 1, 9999]) assert.equal((await check(ok)).status, 200, `check ${ok}`);
    for (const bad of [0, 10000, "12", 1.5, -1, true]) {
      const checked = await check(bad);
      assert.equal(checked.status, 400, `check ${JSON.stringify(bad)}`);
      assert.match(checked.json.error, /paperNumber must be null or a whole number from 1 to 9999/);
      assert.equal((await apply(ctx, review, { date: DAY, paperNumber: bad })).status, 400, `apply ${JSON.stringify(bad)}`);
    }
    assert.deepEqual(await index(ctx), []);
    const entries = (await api(ctx.base, "GET", `/api/entries?from=${DAY}&to=${DAY}`, { headers: ctx.signed.headers })).json.entries;
    assert.deepEqual(entries, [], "a refused apply wrote nothing");
    assert.equal((await apply(ctx, review, { date: DAY, paperNumber: 12 })).status, 200);
    assert.deepEqual(await index(ctx), [{ number: 12, kind: "day", ref: DAY, page: 1 }]);
  });
});

test("apply stores the number per kind: each page of a day, a month log, a future log", async () => {
  await withScan(async (ctx) => {
    assert.equal((await apply(ctx, await scan(ctx, null, ["Alpha"]), { date: DAY, page: 1, paperNumber: 14 })).status, 200);
    assert.equal((await apply(ctx, await scan(ctx, null, ["Charlie"]), { date: DAY, page: 2, paperNumber: 15 })).status, 200);
    const month = await scan(ctx, null, ["Geschenke"]);
    assert.equal((await api(ctx.base, "POST", `/api/log/scan/${month.id}/apply`, { body: { kind: "month-task", month: "2027-03", paperNumber: 20, items: items(month) }, headers: ctx.signed.headers })).status, 200);
    const future = await scan(ctx, null, ["Urlaub", "Steuer"]);
    const futureItems = [{ ...items(future)[0], month: "2027-05" }, { ...items(future)[1], month: "2027-03" }];
    assert.equal((await api(ctx.base, "POST", `/api/log/scan/${future.id}/apply`, { body: { kind: "future", paperNumber: 30, items: futureItems }, headers: ctx.signed.headers })).status, 200);
    assert.deepEqual(await index(ctx), [
      { number: 14, kind: "day", ref: DAY, page: 1 },
      { number: 15, kind: "day", ref: DAY, page: 2 },
      { number: 20, kind: "month", ref: "2027-03", page: 1 },
      { number: 30, kind: "future", ref: "2027-03", page: 1 },
    ]);
  });
});

test("a scan without a number keeps the stored one, a new number replaces it, and the entries are written either way", async () => {
  await withScan(async (ctx) => {
    await apply(ctx, await scan(ctx, null, ["Alpha"]), { date: DAY, paperNumber: 14 });
    for (const sent of [undefined, null]) {
      const again = await scan(ctx, null, ["Alpha", `Bravo ${String(sent)}`]);
      assert.equal((await apply(ctx, again, { date: DAY, page: 1, ...(sent === undefined ? {} : { paperNumber: sent }) })).status, 200);
      assert.deepEqual(await index(ctx), [{ number: 14, kind: "day", ref: DAY, page: 1 }]);
    }
    const titles = (await api(ctx.base, "GET", `/api/entries?from=${DAY}&to=${DAY}`, { headers: ctx.signed.headers })).json.entries.map((e: any) => e.title);
    assert.deepEqual(titles, ["Alpha", "Bravo undefined", "Bravo null"]);
    await apply(ctx, await scan(ctx, null, ["Alpha", "Delta"]), { date: DAY, page: 1, paperNumber: 18 });
    assert.deepEqual(await index(ctx), [{ number: 18, kind: "day", ref: DAY, page: 1 }]);
  });
});

test("GET /api/index lists all four kinds ascending, ties by kind, gaps kept, no other user, collections with a number only", async () => {
  await withScan(async (ctx) => {
    const userId = (ctx.app.db.prepare("SELECT id FROM users").get() as { id: string }).id;
    const put = ctx.app.db.prepare("INSERT INTO paper_pages (user_id, kind, ref, page, number) VALUES (?, ?, ?, ?, ?)");
    put.run(userId, "future", "2027-01", 1, 9);
    put.run(userId, "month", "2026-12", 1, 9);
    put.run(userId, "day", "2026-11-20", 2, 9);
    put.run(userId, "day", "2026-11-20", 1, 9);
    put.run(userId, "day", "2026-11-19", 1, 9);
    put.run(userId, "day", "2026-11-18", 1, 3);
    const made = async (name: string, paperPage?: number) => (await api(ctx.base, "POST", "/api/collections", { body: { name, ...(paperPage === undefined ? {} : { paperPage }) }, headers: ctx.signed.headers })).json.collection;
    const books = await made("Books", 9);
    await made("Loose");
    // A second account: the single-user trigger is dropped only in this test database.
    ctx.app.db.exec("DROP TRIGGER users_single_user");
    ctx.app.db.prepare("INSERT INTO users (id, name, recovery_hash, created_at) VALUES ('other', 'Other', 'x', 0)").run();
    put.run("other", "day", "2026-11-18", 1, 1);
    const pages = await index(ctx);
    assert.deepEqual(pages, [
      { number: 3, kind: "day", ref: "2026-11-18", page: 1 },
      { number: 9, kind: "day", ref: "2026-11-19", page: 1 },
      { number: 9, kind: "day", ref: "2026-11-20", page: 1 },
      { number: 9, kind: "day", ref: "2026-11-20", page: 2 },
      { number: 9, kind: "month", ref: "2026-12", page: 1 },
      { number: 9, kind: "future", ref: "2027-01", page: 1 },
      { number: 9, kind: "collection", ref: books.id, page: 1, label: "Books" },
    ]);
    assert.equal((await api(ctx.base, "GET", "/api/index")).status, 401);
  });
});

test("a database made without paper_pages gets the table on open", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bujo-paper-pages-"));
  try {
    const file = path.join(dir, "old.db");
    const first = openDb(file);
    first.exec("DROP TABLE paper_pages");
    first.close();
    const db = openDb(file);
    const columns = (db.prepare("PRAGMA table_info(paper_pages)").all() as Array<{ name: string }>).map((c) => c.name);
    assert.deepEqual(columns, ["user_id", "kind", "ref", "page", "number", "notebook_id"]);
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
