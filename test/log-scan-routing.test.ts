import assert from "node:assert/strict";
import test from "node:test";
import { demoSource } from "../src/caldav/source.ts";
import { createOcrClient } from "../src/scan/ocr-client.ts";
import { line, startFakeOcr, type FakeOcr } from "./fake-ocr.ts";
import { api, signUp, withApp, type Signed } from "./helpers.ts";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const YESTERDAY = "2026-11-25";
const TODAY = "2026-11-26";
const HEADED = "2026-11-20";

type Ctx = { base: string; ocr: FakeOcr; signed: Signed };
type Stored = { id: string; title: string; page: number | null };

/** The app with the demo source (no CalDAV) and the fake OCR. Nothing here reaches a real list or a third party. */
async function withScan(fn: (ctx: Ctx) => Promise<void>): Promise<void> {
  const ocr = await startFakeOcr([]);
  try {
    await withApp(demoSource(), async ({ base }) => fn({ base, ocr, signed: await signUp(base) }), { ocr: createOcrClient(ocr.url, { timeoutMs: 1500 }) });
  } finally {
    await ocr.close();
  }
}

/** Scans bullet lines (under a header line when given) with the query the scan screen would send. */
async function scan(ctx: Ctx, titles: string[], opts: { header?: string; query?: string; date?: string } = {}) {
  ctx.ocr.setLines([...(opts.header ? [line("none", opts.header)] : []), ...titles.map((title) => line("•", title))]);
  const response = await fetch(`${ctx.base}/api/log/scan?date=${opts.date ?? TODAY}${opts.query ?? ""}`, { method: "POST", headers: { "content-type": "image/png", ...ctx.signed.headers }, body: new Uint8Array(PNG) });
  return (await response.json()).draft;
}

/** Applies every line of a review on the day and page it shows. */
async function applyReview(ctx: Ctx, review: any) {
  const items = review.items.map((i: any) => ({ id: i.id, type: i.type, title: i.title, tags: i.tags, time: i.time }));
  return api(ctx.base, "POST", `/api/log/scan/${review.id}/apply`, { body: { date: review.date, page: review.page, items }, headers: ctx.signed.headers });
}

const stored = async (ctx: Ctx, date: string): Promise<Stored[]> => (await api(ctx.base, "GET", `/api/entries?from=${date}&to=${date}`, { headers: ctx.signed.headers })).json.entries;
const rows = (entries: Stored[]) => entries.map((e) => [e.title, e.page]);

test("routing: a day picked on the scan screen beats the date read from the page header", async () => {
  await withScan(async (ctx) => {
    const review = await scan(ctx, ["Alpha"], { header: "20.11.2026", query: "&picked=1", date: YESTERDAY });
    assert.equal(review.date, YESTERDAY);
    assert.equal(review.picked, true);
    assert.equal(review.pageDate, HEADED, "the header is still reported");
    assert.equal((await applyReview(ctx, review)).status, 200);
    assert.deepEqual(rows(await stored(ctx, YESTERDAY)), [["Alpha", 1]]);
    assert.deepEqual(await stored(ctx, HEADED), []);
  });
});

test("routing: without a pick the header wins over the default day, and with neither the default is used", async () => {
  await withScan(async (ctx) => {
    const headed = await scan(ctx, ["Alpha"], { header: "20.11.2026" });
    assert.equal(headed.date, HEADED);
    assert.equal(headed.picked, false);
    assert.equal((await scan(ctx, ["Beta"])).date, TODAY);
  });
});

test("routing: a day picked in the scan screen survives a kind switch", async () => {
  await withScan(async (ctx) => {
    const review = await scan(ctx, ["Alpha"], { header: "20.11.2026", query: "&picked=1", date: YESTERDAY });
    const switched = await api(ctx.base, "POST", `/api/log/scan/${review.id}/kind`, { body: { kind: "daily" }, headers: ctx.signed.headers });
    assert.equal(switched.json.draft.date, YESTERDAY);
    assert.equal(switched.json.draft.picked, true);
  });
});

test("rescan: page 1 of a day is updated in place and reordered, other pages and other entries are untouched, nothing is duplicated", async () => {
  await withScan(async (ctx) => {
    const day = { date: YESTERDAY, query: "&picked=1" };
    await applyReview(ctx, await scan(ctx, ["Call the dentist", "Buy bread", "Write report"], day));
    const second = await scan(ctx, ["Pack the bag", "Water plants"], day);
    assert.equal(second.page, 2);
    await applyReview(ctx, second);
    const before = await stored(ctx, YESTERDAY);
    const idsOf = (entries: Stored[]) => Object.fromEntries(entries.map((e) => [e.title, e.id]));

    const rescan = await scan(ctx, ["Write report", "Call the dentist", "Buy bread and milk", "New idea"], day);
    assert.equal(rescan.page, 1, "the lines match page 1, so this is a rescan of it");
    assert.deepEqual(rescan.items.map((i: any) => i.status), ["unchanged", "unchanged", "edited", "new"], "the reworded line is matched, not added again");
    assert.equal((await applyReview(ctx, rescan)).status, 200);

    const after = await stored(ctx, YESTERDAY);
    assert.equal(after.length, 6, "no duplicates");
    assert.deepEqual(rows(after), [["Write report", 1], ["Call the dentist", 1], ["Buy bread and milk", 1], ["New idea", 1], ["Pack the bag", 2], ["Water plants", 2]]);
    const ids = idsOf(after);
    assert.equal(ids["Write report"], idsOf(before)["Write report"], "matched in place, same entry");
    assert.equal(ids["Buy bread and milk"], idsOf(before)["Buy bread"], "the reworded entry keeps its id");
    assert.equal(ids["Pack the bag"], idsOf(before)["Pack the bag"], "page 2 is untouched");
  });
});
