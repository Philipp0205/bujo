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
const DAY = "2026-11-20";
const LATER = "2026-11-27";
const HEADER = line("none", "20.11.2026");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Ctx = { base: string; ocr: FakeOcr; signed: Signed };
type Item = { id: string; type: string; title: string; tags: string[]; time: string | null; status: string; include: boolean; traced?: boolean; offPaper?: boolean };

/** The app with the demo source (no CalDAV) and the fake OCR. Nothing here reaches a real list. */
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

async function scanLines(ctx: Ctx, lines: ReturnType<typeof line>[]) {
  ctx.ocr.setLines(lines);
  const response = await fetch(`${ctx.base}/api/log/scan`, { method: "POST", headers: { "content-type": "image/png", ...ctx.signed.headers }, body: new Uint8Array(PNG) });
  return (await response.json()).draft as { id: string; items: Item[] };
}

/** Applies a draft with every line as the review shows it (the client sends unchanged lines as skipped). */
function applyDraft(ctx: Ctx, draft: { id: string; items: Item[] }) {
  const items = draft.items.map((i) => ({ id: i.id, type: i.type, title: i.title, tags: i.tags, time: i.time, include: i.include }));
  return api(ctx.base, "POST", `/api/log/scan/${draft.id}/apply`, { body: { date: DAY, items }, headers: ctx.signed.headers });
}

const all = async (ctx: Ctx, query = "") =>
  (await api(ctx.base, "GET", `/api/entries?from=2026-11-01&to=2026-12-31${query}`, { headers: ctx.signed.headers })).json.entries as Array<{ id: string; date: string; type: string; title: string; onPaper: boolean }>;
const notOnPaper = async (ctx: Ctx) => (await all(ctx, "&onPaper=0")).map((e) => `${e.date} ${e.type} ${e.title}`);
const patch = (ctx: Ctx, id: string, body: object) => api(ctx.base, "PATCH", `/api/entries/${id}`, { body, headers: ctx.signed.headers });

/** Scans and applies a first page of open tasks, so each has a paper snapshot like a real day. */
async function firstPage(ctx: Ctx, titles: string[]) {
  const first = await scanLines(ctx, [HEADER, ...titles.map((title) => line("•", title))]);
  assert.equal((await applyDraft(ctx, first)).status, 200);
  const entries = await all(ctx);
  return (title: string) => entries.find((e) => e.title === title)!;
}

test("rescan: a page that already shows the app's migrated status can be applied and takes the entry off the not-on-paper list", async () => {
  await withLogScan(async (ctx) => {
    const of = await firstPage(ctx, ["Zahnarzt anrufen", "Brot kaufen"]);
    await sleep(5);
    assert.equal((await patch(ctx, of("Zahnarzt anrufen").id, { type: "migrated" })).status, 200);
    assert.deepEqual(await notOnPaper(ctx), [`${DAY} migrated Zahnarzt anrufen`], "an app-side status change makes the entry unwritten");

    // The paper shows the same status. Every line matches its entry unchanged, so nothing is new or edited.
    const second = await scanLines(ctx, [HEADER, line(">", "Zahnarzt anrufen"), line("•", "Brot kaufen")]);
    assert.deepEqual(second.items.map((i) => [i.title, i.status, i.offPaper]), [["Zahnarzt anrufen", "unchanged", true], ["Brot kaufen", "unchanged", undefined]]);
    const applied = await applyDraft(ctx, second);
    assert.equal(applied.status, 200, "confirming what the paper shows is allowed");
    assert.deepEqual(applied.json.results, [], "no entry was created or changed");

    assert.deepEqual(await notOnPaper(ctx), []);
    const entries = await all(ctx);
    assert.equal(entries.length, 2);
    assert.equal(entries.find((e) => e.title === "Zahnarzt anrufen")!.type, "migrated");
  });
});

test("rescan: an entry made in the app and matched unchanged by a page is marked on paper, and a page with nothing left to confirm has nothing to apply", async () => {
  await withLogScan(async (ctx) => {
    const seeded = await api(ctx.base, "POST", "/api/entries", { body: { date: DAY, type: "done", title: "Wäsche waschen" }, headers: ctx.signed.headers });
    assert.equal(seeded.json.entry.onPaper, false);
    const page = [HEADER, line("x", "Wäsche waschen")];
    const first = await scanLines(ctx, page);
    assert.deepEqual(first.items.map((i) => [i.status, i.offPaper]), [["unchanged", true]]);
    assert.equal((await applyDraft(ctx, first)).status, 200);
    assert.equal((await all(ctx))[0].onPaper, true);

    const again = await scanLines(ctx, page);
    assert.deepEqual(again.items.map((i) => [i.status, i.offPaper]), [["unchanged", undefined]]);
    assert.equal((await applyDraft(ctx, again)).status, 400, "already on paper: nothing to confirm");
  });
});

test("rescan: a line for an entry that moved to another day is its trace, whatever the symbol, and never adds a second entry", async () => {
  await withLogScan(async (ctx) => {
    const of = await firstPage(ctx, ["Post abholen", "Steuer machen", "Brot kaufen"]);
    await sleep(5);
    assert.equal((await patch(ctx, of("Post abholen").id, { date: LATER, trace: "migrated" })).status, 200);
    assert.equal((await patch(ctx, of("Steuer machen").id, { date: LATER, trace: "migrated" })).status, 200);

    // The paper still shows an open bullet for one moved task and a tick for the other: both are the old page's line for an entry that left.
    const second = await scanLines(ctx, [HEADER, line("•", "Post abholen"), line("x", "Steuer machen"), line("•", "Brot kaufen"), line("•", "Milch")]);
    assert.deepEqual(second.items.map((i) => [i.title, i.status, i.traced]), [
      ["Post abholen", "unchanged", true],
      ["Steuer machen", "unchanged", true],
      ["Brot kaufen", "unchanged", undefined],
      ["Milch", "new", undefined],
    ]);
    assert.equal((await applyDraft(ctx, second)).status, 200);
    const titles = (await all(ctx)).map((e) => `${e.date} ${e.title}`).sort();
    assert.deepEqual(titles, [`${DAY} Brot kaufen`, `${DAY} Milch`, `${LATER} Post abholen`, `${LATER} Steuer machen`]);
  });
});

test("rescan: applying the same rescan twice never changes the number of entries", async () => {
  await withLogScan(async (ctx) => {
    await firstPage(ctx, ["Post abholen", "Brot kaufen"]);
    const lines = [HEADER, line("x", "Brot kaufen"), line(">", "Post abholen")];
    for (let round = 0; round < 3; round += 1) {
      const draft = await scanLines(ctx, lines);
      await applyDraft(ctx, draft);
      const entries = await all(ctx);
      assert.equal(entries.length, 2, `round ${round + 1}`);
    }
    assert.deepEqual(await notOnPaper(ctx), []);
  });
});
