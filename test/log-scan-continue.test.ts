import assert from "node:assert/strict";
import test from "node:test";
import { demoSource } from "../src/caldav/source.ts";
import { CONTINUE_WITHIN_DAYS, continuedDay } from "../src/log/scan/continue.ts";
import { fixedReader } from "../src/log/scan/plan.ts";
import type { ScanEntry } from "../src/log/types.ts";
import { createOcrClient } from "../src/scan/ocr-client.ts";
import { line, startFakeOcr, type FakeOcr } from "./fake-ocr.ts";
import { api, signUp, withApp, type Signed } from "./helpers.ts";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const FIRST = "2026-11-20";
const LATER = "2026-11-22";

/** A fake entry of a day: on paper (a page number) or only in the app (null). */
const entry = (date: string, page: number | null): ScanEntry => ({ date, horizon: "day", page } as unknown as ScanEntry);

test("continuedDay: finds the latest earlier day with paper inside the window", () => {
  const reader = fixedReader([entry("2026-11-21", 1)]);
  assert.equal(continuedDay(LATER, reader), "2026-11-21");
  assert.equal(continuedDay(LATER, fixedReader([entry(FIRST, 2)])), FIRST);
});

test("continuedDay: picks the latest of two candidate days", () => {
  assert.equal(continuedDay("2026-11-23", fixedReader([entry(FIRST, 1), entry("2026-11-21", 1)])), "2026-11-21");
});

test("continuedDay: ignores days with only app entries", () => {
  assert.equal(continuedDay(LATER, fixedReader([entry("2026-11-21", null), entry(FIRST, 1)])), FIRST);
  assert.equal(continuedDay(LATER, fixedReader([entry("2026-11-21", null)])), null);
});

test("continuedDay: ignores days older than the window", () => {
  assert.equal(CONTINUE_WITHIN_DAYS, 3);
  assert.equal(continuedDay("2026-11-24", fixedReader([entry(FIRST, 1)])), null);
  assert.equal(continuedDay("2026-11-23", fixedReader([entry(FIRST, 1)])), FIRST);
});

test("continuedDay: does nothing when the fallback day itself has paper, or only has later days", () => {
  assert.equal(continuedDay(LATER, fixedReader([entry(LATER, 1), entry(FIRST, 1)])), null);
  assert.equal(continuedDay(FIRST, fixedReader([entry(LATER, 1)])), null);
});

type Ctx = { base: string; ocr: FakeOcr; signed: Signed };

async function withScan(fn: (ctx: Ctx) => Promise<void>): Promise<void> {
  const ocr = await startFakeOcr([]);
  try {
    await withApp(demoSource(), async ({ base }) => fn({ base, ocr, signed: await signUp(base) }), { ocr: createOcrClient(ocr.url, { timeoutMs: 1500 }) });
  } finally {
    await ocr.close();
  }
}

/** Scans a photo of bullet lines (with the header, when given) and answers the review. */
async function scan(ctx: Ctx, titles: string[], opts: { header?: string; query?: string } = {}) {
  const header = opts.header ? [line("none", opts.header)] : [];
  ctx.ocr.setLines([...header, ...titles.map((title) => line("•", title))]);
  const response = await fetch(`${ctx.base}/api/log/scan?date=${LATER}${opts.query ?? ""}`, { method: "POST", headers: { "content-type": "image/png", ...ctx.signed.headers }, body: new Uint8Array(PNG) });
  return (await response.json()).draft;
}

async function applyReview(ctx: Ctx, review: any) {
  const items = review.items.map((i: any) => ({ id: i.id, type: i.type, title: i.title, tags: i.tags, time: i.time }));
  return api(ctx.base, "POST", `/api/log/scan/${review.id}/apply`, { body: { date: review.date, page: review.page, items }, headers: ctx.signed.headers });
}

const stored = async (ctx: Ctx, date: string): Promise<Array<{ title: string; page: number | null }>> =>
  (await api(ctx.base, "GET", `/api/entries?from=${date}&to=${date}`, { headers: ctx.signed.headers })).json.entries;

test("api: a page with no date continues the earlier day as its next page, and apply files it there", async () => {
  await withScan(async (ctx) => {
    assert.equal((await applyReview(ctx, await scan(ctx, ["Alpha", "Bravo"], { header: "20.11.2026" }))).status, 200);
    const next = await scan(ctx, ["Charlie", "Delta"]);
    assert.equal(next.date, FIRST);
    assert.equal(next.continues, FIRST);
    assert.equal(next.pageDate, null);
    assert.equal(next.fallbackDate, LATER);
    assert.equal(next.page, 2);
    assert.deepEqual(next.pages, [1]);
    assert.equal((await applyReview(ctx, next)).status, 200);
    assert.deepEqual((await stored(ctx, FIRST)).map((e) => [e.title, e.page]), [["Alpha", 1], ["Bravo", 1], ["Charlie", 2], ["Delta", 2]]);
    assert.deepEqual(await stored(ctx, LATER), []);
  });
});

test("api: pinned=1 files on the day asked for, with no continuation", async () => {
  await withScan(async (ctx) => {
    await applyReview(ctx, await scan(ctx, ["Alpha"], { header: "20.11.2026" }));
    const pinned = await scan(ctx, ["Charlie"], { query: "&pinned=1" });
    assert.equal(pinned.date, LATER);
    assert.equal(pinned.continues, null);
    assert.equal(pinned.page, 1);
  });
});

test("api: a date header files on its own day and is no continuation", async () => {
  await withScan(async (ctx) => {
    await applyReview(ctx, await scan(ctx, ["Alpha"], { header: "20.11.2026" }));
    const headed = await scan(ctx, ["Charlie"], { header: "21.11.2026" });
    assert.equal(headed.date, "2026-11-21");
    assert.equal(headed.continues, null);
  });
});

test("api: switching the kind to daily continues the same way", async () => {
  await withScan(async (ctx) => {
    await applyReview(ctx, await scan(ctx, ["Alpha"], { header: "20.11.2026" }));
    const next = await scan(ctx, ["Charlie"]);
    const switched = await api(ctx.base, "POST", `/api/log/scan/${next.id}/kind`, { body: { kind: "daily" }, headers: ctx.signed.headers });
    assert.equal(switched.json.draft.continues, FIRST);
  });
});
