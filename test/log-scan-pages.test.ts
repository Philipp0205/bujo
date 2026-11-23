import assert from "node:assert/strict";
import test from "node:test";
import { demoSource } from "../src/caldav/source.ts";
import { openDb } from "../src/db.ts";
import { createEntryStore } from "../src/log/store.ts";
import { createOcrClient } from "../src/scan/ocr-client.ts";
import { line, startFakeOcr, type FakeOcr } from "./fake-ocr.ts";
import { api, signUp, withApp, type Signed } from "./helpers.ts";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const DAY = "2026-11-20";
const HEADER = line("none", "20.11.2026");

type Ctx = { base: string; ocr: FakeOcr; signed: Signed };
type Stored = { id: string; title: string; page: number | null };

/** The app with the demo source (no CalDAV) and the fake OCR. Nothing here reaches a real list. */
async function withScan(fn: (ctx: Ctx) => Promise<void>): Promise<void> {
  const ocr = await startFakeOcr([]);
  try {
    await withApp(demoSource(), async ({ base }) => fn({ base, ocr, signed: await signUp(base) }), { ocr: createOcrClient(ocr.url, { timeoutMs: 1500 }) });
  } finally {
    await ocr.close();
  }
}

/** Scans a page of bullet lines under the day header and answers the review. */
async function scanPage(ctx: Ctx, titles: string[]) {
  ctx.ocr.setLines([HEADER, ...titles.map((title) => line("•", title))]);
  const response = await fetch(`${ctx.base}/api/log/scan`, { method: "POST", headers: { "content-type": "image/png", ...ctx.signed.headers }, body: new Uint8Array(PNG) });
  return (await response.json()).draft;
}

/** Applies every line of a review on a page (the number is left out when undefined). */
async function applyPage(ctx: Ctx, review: any, page?: number) {
  const items = review.items.map((i: any) => ({ id: i.id, type: i.type, title: i.title, tags: i.tags, time: i.time }));
  return api(ctx.base, "POST", `/api/log/scan/${review.id}/apply`, { body: { date: DAY, ...(page === undefined ? {} : { page }), items }, headers: ctx.signed.headers });
}

const dayOf = async (ctx: Ctx): Promise<Stored[]> => (await api(ctx.base, "GET", `/api/entries?from=${DAY}&to=${DAY}`, { headers: ctx.signed.headers })).json.entries;
const titles = async (ctx: Ctx) => (await dayOf(ctx)).map((e) => e.title);
const addManual = (ctx: Ctx, title: string) => api(ctx.base, "POST", "/api/entries", { body: { date: DAY, type: "task", title }, headers: ctx.signed.headers });

test("order: a scan keeps the paper line order, and an entry written in the app stays after every paper line", async () => {
  await withScan(async (ctx) => {
    await addManual(ctx, "Zeitung holen");
    const review = await scanPage(ctx, ["Alpha", "Bravo", "Charlie"]);
    assert.equal((await applyPage(ctx, review)).status, 200);
    const day = await dayOf(ctx);
    assert.deepEqual(day.map((e) => e.title), ["Alpha", "Bravo", "Charlie", "Zeitung holen"]);
    assert.deepEqual(day.map((e) => e.page), [1, 1, 1, null]);
    await addManual(ctx, "Spaeter");
    assert.deepEqual(await titles(ctx), ["Alpha", "Bravo", "Charlie", "Zeitung holen", "Spaeter"], "manual entries append at the end");
  });
});

test("order: a rescan that finds a new line in the middle files it in the middle", async () => {
  await withScan(async (ctx) => {
    await applyPage(ctx, await scanPage(ctx, ["Alpha", "Charlie"]));
    const again = await scanPage(ctx, ["Alpha", "Bravo", "Charlie"]);
    assert.equal(again.page, 1, "the lines match page 1, so this is a rescan of it");
    assert.equal((await applyPage(ctx, again, 1)).status, 200);
    assert.deepEqual(await titles(ctx), ["Alpha", "Bravo", "Charlie"]);
  });
});

test("order: an entry the rescan did not list stays beside the entry above it", async () => {
  await withScan(async (ctx) => {
    await applyPage(ctx, await scanPage(ctx, ["Alpha", "Bravo", "Charlie"]));
    await applyPage(ctx, await scanPage(ctx, ["Alpha", "Charlie", "Delta"]), 1);
    assert.deepEqual(await titles(ctx), ["Alpha", "Bravo", "Charlie", "Delta"]);
  });
});

test("pages: a first scan of page 2 appends after page 1 and does not replace or match it", async () => {
  await withScan(async (ctx) => {
    await applyPage(ctx, await scanPage(ctx, ["Alpha", "Bravo"]));
    const second = await scanPage(ctx, ["Charlie", "Delta"]);
    assert.equal(second.page, 2, "nothing on this page matches page 1, so the next page is suggested");
    assert.deepEqual(second.pages, [1]);
    assert.equal((await applyPage(ctx, second, 2)).status, 200);
    const day = await dayOf(ctx);
    assert.deepEqual(day.map((e) => [e.title, e.page]), [["Alpha", 1], ["Bravo", 1], ["Charlie", 2], ["Delta", 2]]);
  });
});

test("pages: page 2 lines never match page 1 entries, even with the same title", async () => {
  await withScan(async (ctx) => {
    await applyPage(ctx, await scanPage(ctx, ["Alpha"]));
    const second = await scanPage(ctx, ["Alpha", "Bravo"]);
    assert.equal(second.page, 1, "Alpha matches page 1, so the review suggests a rescan of it");
    const check = await api(ctx.base, "POST", `/api/log/scan/${second.id}/check`, {
      body: { date: DAY, page: 2, items: [{ id: "l2", type: "task", title: "Alpha" }] },
      headers: ctx.signed.headers,
    });
    assert.equal(check.json.items[0].status, "new");
    assert.equal(check.json.page, 2);
    assert.deepEqual(check.json.pages, [1]);
  });
});

test("pages: a rescan of page 1 does not wipe page 2 and keeps it after page 1", async () => {
  await withScan(async (ctx) => {
    await applyPage(ctx, await scanPage(ctx, ["Alpha", "Bravo"]));
    await applyPage(ctx, await scanPage(ctx, ["Charlie", "Delta"]), 2);
    const rescan = await scanPage(ctx, ["Alpha", "Zulu", "Bravo"]);
    assert.equal(rescan.page, 1);
    assert.deepEqual(rescan.items.map((i: any) => i.status), ["unchanged", "new", "unchanged"]);
    assert.equal((await applyPage(ctx, rescan, 1)).status, 200);
    const day = await dayOf(ctx);
    assert.deepEqual(day.map((e) => [e.title, e.page]), [["Alpha", 1], ["Zulu", 1], ["Bravo", 1], ["Charlie", 2], ["Delta", 2]]);
  });
});

test("pages: an unwritten entry stays after page 2 as well, and a request without a page is page 1", async () => {
  await withScan(async (ctx) => {
    await addManual(ctx, "Zeitung holen");
    await applyPage(ctx, await scanPage(ctx, ["Alpha"]));
    await applyPage(ctx, await scanPage(ctx, ["Charlie"]), 2);
    assert.deepEqual(await titles(ctx), ["Alpha", "Charlie", "Zeitung holen"]);
  });
});

test("pages: page must be a whole number from 1 to 20", async () => {
  await withScan(async (ctx) => {
    const review = await scanPage(ctx, ["Alpha"]);
    for (const page of [0, 21, 1.5, "2", null]) {
      assert.equal((await applyPage(ctx, review, page as number)).status, 400, String(page));
    }
    assert.deepEqual(await titles(ctx), []);
  });
});

test("store: placeOnPaper orders pages and a move never swaps across a page boundary", () => {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO users (id, name, recovery_hash, created_at) VALUES (?, ?, ?, ?)").run("u", "P", "hash", 1);
  const store = createEntryStore(db);
  const make = (title: string) => store.create("u", { date: DAY, type: "task", title, tags: [], time: null }, 1).id;
  const [a, b, c, loose] = ["A", "B", "C", "loose"].map(make);
  store.placeOnPaper("u", { date: DAY, horizon: "day" }, 2, [c]);
  store.placeOnPaper("u", { date: DAY, horizon: "day" }, 1, [b, a]);
  const order = () => store.list("u", { from: DAY, to: DAY }).map((e) => e.title);
  assert.deepEqual(order(), ["B", "A", "C", "loose"]);
  assert.deepEqual(store.move("u", a, "down")!.map((e) => e.title), ["B", "A", "C", "loose"], "A is last on page 1");
  assert.deepEqual(store.move("u", c, "down")!.map((e) => e.title), ["B", "A", "C", "loose"], "C is last on page 2");
  assert.deepEqual(store.move("u", a, "up")!.map((e) => e.title), ["A", "B", "C", "loose"], "inside a page it swaps");
  const moved = store.update("u", b, { date: "2026-11-21" }, 2)!;
  assert.equal(moved.page, null, "another day is not on that page");
  assert.equal(store.get("u", loose)!.page, null);
});
