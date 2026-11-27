import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { demoSource } from "../src/caldav/source.ts";
import { createOcrClient } from "../src/scan/ocr-client.ts";
import { line, startFakeOcr, type FakeOcr } from "./fake-ocr.ts";
import { api, signUp, withApp, type Signed } from "./helpers.ts";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const DAY = "2026-11-20";
const NEXT = "2026-11-25";
const TODAY = "2026-11-25";
const header = (date: string) => line("none", `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`);

type Ctx = { base: string; ocr: FakeOcr; signed: Signed };
type Item = { id: string; type: string; title: string; tags: string[]; time: string | null; status: string; include: boolean; traced?: boolean; offPaper?: boolean; migratedFrom?: unknown };
type Entry = { id: string; date: string; horizon: string; type: string; title: string; onPaper: boolean; isTrace?: boolean };

/** The pure model of the migration review, loaded the way the page loads it. */
function reviewModel() {
  const window: { BujoLog?: any } = {};
  const context = vm.createContext({ window, Object, Array, Math, JSON, String, Number });
  for (const file of ["dates", "days", "migrate/model"]) vm.runInContext(readFileSync(new URL(`../public/js/log/${file}.js`, import.meta.url), "utf8"), context);
  return window.BujoLog.migrate.model as { open: (entries: Entry[], today: string) => Entry[] };
}
const MODEL = reviewModel();

async function withLogScan(fn: (ctx: Ctx) => Promise<void>): Promise<void> {
  const ocr = await startFakeOcr([]);
  try {
    await withApp(demoSource(), async ({ base }) => {
      await fn({ base, ocr, signed: await signUp(base) });
    }, { ocr: createOcrClient(ocr.url, { timeoutMs: 1500 }) });
  } finally {
    await ocr.close();
  }
}

async function scan(ctx: Ctx, lines: ReturnType<typeof line>[]) {
  ctx.ocr.setLines(lines);
  const response = await fetch(`${ctx.base}/api/log/scan`, { method: "POST", headers: { "content-type": "image/png", ...ctx.signed.headers }, body: new Uint8Array(PNG) });
  return (await response.json()).draft as { id: string; items: Item[] };
}

/** Applies a draft the way the review does: lines it keeps by default are sent included, the rest skipped. */
function apply(ctx: Ctx, draft: { id: string; items: Item[] }, date: string, include: (item: Item) => boolean = (item) => item.include) {
  const items = draft.items.map((i) => ({ id: i.id, type: i.type, title: i.title, tags: i.tags, time: i.time, include: include(i) }));
  return api(ctx.base, "POST", `/api/log/scan/${draft.id}/apply`, { body: { date, items }, headers: ctx.signed.headers });
}

const entries = async (ctx: Ctx) =>
  (await api(ctx.base, "GET", "/api/entries?from=2026-11-01&to=2026-12-31&traces=1", { headers: ctx.signed.headers })).json.entries as Entry[];
const candidates = async (ctx: Ctx) => MODEL.open(await entries(ctx), TODAY).map((e) => `${e.date} ${e.title}`);
const seed = (ctx: Ctx, date: string, title: string) => api(ctx.base, "POST", "/api/entries", { body: { date, type: "task", title }, headers: ctx.signed.headers });

async function firstPage(ctx: Ctx, date: string, titles: string[]) {
  const draft = await scan(ctx, [header(date), ...titles.map((t) => line("•", t))]);
  assert.equal((await apply(ctx, draft, date)).status, 200);
}

for (const [symbol, type] of [[">", "migrated"], ["<", "scheduled"], ["x", "done"]] as const) {
  test(`paper ${symbol} on a rescanned day takes the task out of the migration review`, async () => {
    await withLogScan(async (ctx) => {
      await firstPage(ctx, DAY, ["Zahnarzt anrufen", "Brot kaufen"]);
      assert.deepEqual(await candidates(ctx), [`${DAY} Zahnarzt anrufen`, `${DAY} Brot kaufen`]);
      const second = await scan(ctx, [header(DAY), line(symbol, "Zahnarzt anrufen"), line("•", "Brot kaufen")]);
      assert.equal((await apply(ctx, second, DAY)).status, 200);
      assert.deepEqual(await candidates(ctx), [`${DAY} Brot kaufen`]);
      assert.equal((await entries(ctx)).find((e) => e.title === "Zahnarzt anrufen")!.type, type);
    });
  });
}

test("paper > on a day the app only knows from typing takes the task out of the migration review", async () => {
  await withLogScan(async (ctx) => {
    await seed(ctx, DAY, "Post abholen");
    const draft = await scan(ctx, [header(DAY), line(">", "Post abholen")]);
    assert.equal((await apply(ctx, draft, DAY)).status, 200);
    assert.deepEqual(await candidates(ctx), []);
  });
});

test("paper > on a task edited in the app since the last scan still takes it out of the migration review", async () => {
  await withLogScan(async (ctx) => {
    await firstPage(ctx, DAY, ["Post abholen"]);
    const id = (await entries(ctx))[0].id;
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal((await api(ctx.base, "PATCH", `/api/entries/${id}`, { body: { tags: ["haushalt"] }, headers: ctx.signed.headers })).status, 200);
    const draft = await scan(ctx, [header(DAY), line(">", "Post abholen")]);
    assert.equal((await apply(ctx, draft, DAY)).status, 200);
    assert.deepEqual(await candidates(ctx), []);
  });
});

test("a task written again on a later page does not stay open on its old day, and is not added twice", async () => {
  await withLogScan(async (ctx) => {
    await firstPage(ctx, DAY, ["Post abholen", "Brot kaufen"]);
    const draft = await scan(ctx, [header(NEXT), line("•", "Post abholen"), line("•", "Milch")]);
    assert.equal((await apply(ctx, draft, NEXT)).status, 200);
    const all = await entries(ctx);
    assert.equal(all.filter((e) => e.title === "Post abholen" && !e.isTrace && e.type === "task").length, 1, "one open copy of the task");
    assert.deepEqual(await candidates(ctx), [`${DAY} Brot kaufen`], "the moved task is not asked about on its old day");
  });
});

test("the old day's page afterwards shows a > line that is the trace of the move: no second copy, nothing asked", async () => {
  await withLogScan(async (ctx) => {
    await firstPage(ctx, DAY, ["Post abholen"]);
    const later = await scan(ctx, [header(NEXT), line("•", "Post abholen")]);
    assert.equal((await apply(ctx, later, NEXT)).status, 200);
    const old = await scan(ctx, [header(DAY), line(">", "Post abholen")]);
    assert.deepEqual(old.items.map((i) => [i.status, i.traced]), [["unchanged", true]]);
    const all = await entries(ctx);
    assert.deepEqual(all.filter((e) => e.title === "Post abholen" && !e.isTrace).map((e) => `${e.date} ${e.type}`), [`${NEXT} task`], "one copy, on the later page");
    assert.deepEqual(await candidates(ctx), []);
  });
});

test("a person who says the later line is a different task keeps both: the old one stays open", async () => {
  await withLogScan(async (ctx) => {
    await firstPage(ctx, DAY, ["Post abholen"]);
    const later = await scan(ctx, [header(NEXT), line("•", "Post abholen")]);
    const items = later.items.map((i) => ({ id: i.id, type: i.type, title: i.title, tags: i.tags, time: i.time, include: true, unmatched: true }));
    assert.equal((await api(ctx.base, "POST", `/api/log/scan/${later.id}/apply`, { body: { date: NEXT, items }, headers: ctx.signed.headers })).status, 200);
    assert.deepEqual(await candidates(ctx), [`${DAY} Post abholen`, `${NEXT} Post abholen`]);
    assert.equal((await entries(ctx)).filter((e) => e.title === "Post abholen" && !e.isTrace).length, 2);
  });
});
