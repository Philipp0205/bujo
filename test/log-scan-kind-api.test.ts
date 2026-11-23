import assert from "node:assert/strict";
import test from "node:test";
import { demoSource } from "../src/caldav/source.ts";
import type { Db } from "../src/db.ts";
import { createOcrClient } from "../src/scan/ocr-client.ts";
import { line, startFakeOcr, type FakeOcr } from "./fake-ocr.ts";
import { api, withApp, signUp, type Signed } from "./helpers.ts";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

type Ctx = { base: string; ocr: FakeOcr; signed: Signed; db: Db };
type Entry = { id: string; date: string; horizon: string; type: string; title: string };

async function withLogScan(fn: (ctx: Ctx) => Promise<void>): Promise<void> {
  const ocr = await startFakeOcr([]);
  try {
    await withApp(demoSource(), async ({ base, db }) => {
      await fn({ base, ocr, signed: await signUp(base), db });
    }, { ocr: createOcrClient(ocr.url, { timeoutMs: 1500 }) });
  } finally {
    await ocr.close();
  }
}

/** Scans the lines as a photo and answers the status and the review. */
async function scan(ctx: Ctx, lines: ReturnType<typeof line>[], query = "?date=2026-11-20") {
  ctx.ocr.setLines(lines);
  const response = await fetch(`${ctx.base}/api/log/scan${query}`, { method: "POST", headers: { "content-type": "image/png", ...ctx.signed.headers }, body: new Uint8Array(PNG) });
  const json = await response.json();
  return { status: response.status, review: json.draft, json };
}

const post = (ctx: Ctx, id: string, step: string, body: unknown) => api(ctx.base, "POST", `/api/log/scan/${id}/${step}`, { body, headers: ctx.signed.headers });

/** The review's lines as a request body (ticked ones as they are), for one kind. */
function bodyOf(review: any, extra: Record<string, unknown> = {}) {
  const items = review.items.map((i: any) => ({ id: i.id, type: i.type, title: i.title, tags: i.tags, time: i.time, include: i.include, ...(i.day != null ? { day: i.day } : {}), ...(i.month ? { month: i.month } : {}) }));
  return { kind: review.kind, ...(review.kind === "daily" ? { date: review.date } : {}), ...(review.month ? { month: review.month } : {}), items, ...extra };
}

async function allEntries(ctx: Ctx, from = "2026-11-01", to = "2027-03-31"): Promise<Entry[]> {
  return (await api(ctx.base, "GET", `/api/entries?from=${from}&to=${to}`, { headers: ctx.signed.headers })).json.entries;
}

const FUTURE = [line("none", "Future log 2027"), line("none", "Januar"), line("•", "Steuer machen"), line("○", "15 Zahnarzt"), line("none", "Februar"), line("•", "Urlaub buchen")];
const MONTH = [line("none", "Dezember"), line("•", "Geschenke kaufen"), line("○", "Weihnachtsfeier")];
const CALENDAR = [line("none", "Dezember 2026"), line("none", "1 Di"), line("none", "2 Mi Lunch mit Mira"), line("none", "3 Do"), line("none", "4 Fr Konzert"), line("none", "7 M Team")];

test("scan: a future page is detected, grouped by month, and filing puts each line on the last day of its month", async () => {
  await withLogScan(async (ctx) => {
    const { status, review } = await scan(ctx, FUTURE);
    assert.equal(status, 201);
    assert.deepEqual([review.kind, review.detected], ["future", { kind: "future", source: "page" }]);
    assert.deepEqual(review.items.map((i: any) => [i.title, i.type, i.month, i.status]), [
      ["Steuer machen", "task", "2027-01", "new"],
      ["15 Zahnarzt", "task", "2027-01", "new"],
      ["Urlaub buchen", "task", "2027-02", "new"],
    ]);
    const applied = await post(ctx, review.id, "apply", bodyOf(review));
    assert.equal(applied.status, 200);
    assert.deepEqual([applied.json.kind, applied.json.results.length], ["future", 3]);
    assert.deepEqual((await allEntries(ctx)).map((e) => [e.horizon, e.date, e.type, e.title]), [
      ["future", "2027-01-31", "task", "Steuer machen"],
      ["future", "2027-01-31", "task", "15 Zahnarzt"],
      ["future", "2027-02-28", "task", "Urlaub buchen"],
    ]);
  });
});

test("scan: a month task page files as month-task entries with a month-end date, and an event line is stored as a task", async () => {
  await withLogScan(async (ctx) => {
    const { review } = await scan(ctx, MONTH);
    assert.deepEqual([review.kind, review.month], ["month-task", "2026-12"]);
    assert.equal((await post(ctx, review.id, "apply", bodyOf(review))).status, 200);
    assert.deepEqual((await allEntries(ctx)).map((e) => [e.horizon, e.date, e.type, e.title]), [
      ["month-task", "2026-12-31", "task", "Geschenke kaufen"],
      ["month-task", "2026-12-31", "task", "Weihnachtsfeier"],
    ]);
  });
});

test("scan: a calendar page files day entries on their day, empty days add nothing", async () => {
  await withLogScan(async (ctx) => {
    const { review } = await scan(ctx, CALENDAR);
    assert.deepEqual([review.kind, review.month], ["calendar", "2026-12"]);
    assert.deepEqual(review.items.map((i: any) => [i.day, i.type, i.title]), [[2, "event", "Lunch mit Mira"], [4, "event", "Konzert"], [7, "event", "Team"]]);
    assert.equal((await post(ctx, review.id, "apply", bodyOf(review))).status, 200);
    assert.deepEqual((await allEntries(ctx, "2026-12-01", "2026-12-31")).map((e) => [e.horizon, e.date, e.type, e.title]), [
      ["day", "2026-12-02", "event", "Lunch mit Mira"],
      ["day", "2026-12-04", "event", "Konzert"],
      ["day", "2026-12-07", "event", "Team"],
    ]);
  });
});

test("scan: a leading day number in a future item stays in the title and the item stays in the future month", async () => {
  await withLogScan(async (ctx) => {
    const { review } = await scan(ctx, [line("none", "Januar 2027"), line("•", "15 Zahnarzt"), line("none", "Februar"), line("•", "Skikurs")]);
    await post(ctx, review.id, "apply", bodyOf(review));
    const [dentist] = await allEntries(ctx);
    assert.deepEqual([dentist.horizon, dentist.date, dentist.title], ["future", "2027-01-31", "15 Zahnarzt"]);
  });
});

test("rescan: a filed future or month page matches its entries and does not show an edited event forever", async () => {
  await withLogScan(async (ctx) => {
    for (const lines of [FUTURE, MONTH]) {
      const first = (await scan(ctx, lines)).review;
      await post(ctx, first.id, "apply", bodyOf(first));
      const second = (await scan(ctx, lines)).review;
      assert.deepEqual([...new Set(second.items.map((i: any) => i.status))], ["unchanged"], first.kind);
      assert.equal((await post(ctx, second.id, "apply", bodyOf(second))).status, 400, "nothing to apply");
    }
    assert.equal((await allEntries(ctx, "2026-12-01", "2027-02-28")).length, 5);
  });
});

test("rescan: a ticked-off future item is updated in place, a new one is added, and an entry missing from the page is left alone", async () => {
  await withLogScan(async (ctx) => {
    const first = (await scan(ctx, FUTURE)).review;
    await post(ctx, first.id, "apply", bodyOf(first));
    const before = await allEntries(ctx);
    const second = (await scan(ctx, [line("none", "Januar 2027"), line("x", "Steuer machen"), line("•", "Passport"), line("none", "Februar")])).review;
    assert.deepEqual(second.items.map((i: any) => [i.title, i.status]), [["Steuer machen", "edited"], ["Passport", "new"]]);
    const applied = await post(ctx, second.id, "apply", bodyOf(second));
    assert.deepEqual(applied.json.results.map((r: any) => r.outcome), ["updated", "created"]);
    const now = await allEntries(ctx);
    assert.equal(now.find((e) => e.title === "Steuer machen")!.id, before.find((e) => e.title === "Steuer machen")!.id);
    assert.equal(now.find((e) => e.title === "Steuer machen")!.type, "done");
    assert.ok(now.some((e) => e.title === "Urlaub buchen"), "a line missing from the page deletes nothing");
    assert.equal(now.length, 4);
  });
});

test("scan: a day entry of the last day is not a month entry, matching is per slot", async () => {
  await withLogScan(async (ctx) => {
    await api(ctx.base, "POST", "/api/entries", { body: { date: "2026-12-31", type: "task", title: "Geschenke kaufen" }, headers: ctx.signed.headers });
    const { review } = await scan(ctx, MONTH);
    assert.equal(review.items[0].status, "new");
  });
});

test("scan: ?view= is a weak prior, a bad view is a 400, and a strong page signal beats it", async () => {
  await withLogScan(async (ctx) => {
    const plain = [line("•", "Brot"), line("•", "Milch")];
    assert.equal((await scan(ctx, plain, "?view=future")).review.kind, "future");
    assert.equal((await scan(ctx, plain, "?view=month")).review.kind, "month-task");
    assert.equal((await scan(ctx, plain, "?view=daily")).review.kind, "daily");
    assert.equal((await scan(ctx, plain)).review.kind, "daily");
    assert.equal((await scan(ctx, [line("none", "20.11.2026"), line("•", "x")], "?view=future")).review.kind, "daily");
    assert.equal((await scan(ctx, plain, "?view=weekly")).status, 400);
  });
});

test("scan: the LLM's kind and period are used when they are valid and ignored when they are not", async () => {
  await withLogScan(async (ctx) => {
    const plain = [line("none", "Mai"), line("•", "Brot")];
    ctx.ocr.setPage("future", "2027");
    const llm = (await scan(ctx, plain)).review;
    assert.deepEqual([llm.kind, llm.detected.source, llm.items[0].month], ["future", "llm", "2027-05"]);
    ctx.ocr.setPage("weekly", "x");
    assert.equal((await scan(ctx, plain)).review.kind, "month-task");
  });
});

test("kind switch: reads the page again as the picked kind, edits are not kept, and a bad kind or an unknown draft is refused", async () => {
  await withLogScan(async (ctx) => {
    const { review } = await scan(ctx, MONTH);
    const asFuture = await post(ctx, review.id, "kind", { kind: "future" });
    assert.equal(asFuture.status, 200);
    assert.deepEqual([asFuture.json.draft.kind, asFuture.json.draft.detected.kind], ["future", "month-task"]);
    assert.deepEqual(asFuture.json.draft.items.map((i: any) => i.month), ["2026-12", "2026-12"]);
    const asDaily = await post(ctx, review.id, "kind", { kind: "daily" });
    assert.deepEqual([asDaily.json.draft.kind, asDaily.json.draft.date, asDaily.json.draft.items.length], ["daily", "2026-11-20", 3], "the month heading reads as a plain line");
    assert.equal((await post(ctx, review.id, "kind", { kind: "weekly" })).status, 400);
    assert.equal((await post(ctx, review.id, "kind", { kind: "daily", more: 1 })).status, 400);
    assert.equal((await post(ctx, "nope", "kind", { kind: "daily" })).status, 404);
    assert.equal((await allEntries(ctx)).length, 0, "switching writes nothing");
  });
});

test("check and apply: the request names the kind, month and day, and a bad one is a 400 that writes nothing", async () => {
  await withLogScan(async (ctx) => {
    const { review } = await scan(ctx, CALENDAR);
    const good = bodyOf(review);
    const checked = await post(ctx, review.id, "check", good);
    assert.deepEqual([checked.status, checked.json.kind, checked.json.month, checked.json.items.length], [200, "calendar", "2026-12", 3]);
    const item = good.items[0];
    const bads: unknown[] = [
      { ...good, kind: "weekly" },
      { ...good, month: "2026-13" },
      { ...good, month: undefined },
      { ...good, items: [{ ...item, day: 32 }] },
      { ...good, items: [{ ...item, day: 1.5 }] },
      { ...good, month: "2027-02", items: [{ ...item, day: 30 }] },
      { ...good, items: [{ ...item, day: null }] },
      { kind: "future", items: [{ ...item, month: "2027-13" }] },
      { kind: "future", items: [{ ...item, month: null }] },
      { ...good, date: "nope", kind: "daily" },
    ];
    for (const body of bads) assert.equal((await post(ctx, review.id, "apply", body)).status, 400, JSON.stringify(body).slice(0, 90));
    assert.equal((await allEntries(ctx)).length, 0);
  });
});

test("check: a daily check answers the same shape it always did", async () => {
  await withLogScan(async (ctx) => {
    const { review } = await scan(ctx, [line("none", "20.11.2026"), line("•", "Brot")]);
    const checked = await post(ctx, review.id, "check", { date: "2026-11-21", items: [{ id: "l2", type: "task", title: "Brot" }] });
    assert.deepEqual(Object.keys(checked.json).sort(), ["date", "items"]);
    assert.deepEqual(Object.keys(checked.json.items[0]).sort(), ["after", "before", "contested", "id", "status", "target"]);
  });
});

test("trace: a > line on a page whose entry moved on matches the trace, is unchanged and writes nothing", async () => {
  await withLogScan(async (ctx) => {
    const made = await api(ctx.base, "POST", "/api/entries", { body: { date: "2026-11-20", type: "task", title: "Umzug planen" }, headers: ctx.signed.headers });
    await api(ctx.base, "PATCH", `/api/entries/${made.json.entry.id}`, { body: { date: "2027-01-31", horizon: "future", trace: "migrated" }, headers: ctx.signed.headers });
    const { review } = await scan(ctx, [line("none", "20.11.2026"), line(">", "Umzug planen"), line("•", "Milch")]);
    assert.deepEqual(review.items.map((i: any) => [i.title, i.status, i.traced, i.include]), [["Umzug planen", "unchanged", true, false], ["Milch", "new", undefined, true]]);
    const applied = await post(ctx, review.id, "apply", bodyOf(review));
    assert.deepEqual(applied.json.results.map((r: any) => r.outcome), ["created"]);
    const moved = (await allEntries(ctx)).find((e) => e.title === "Umzug planen")!;
    assert.deepEqual([moved.horizon, moved.date], ["future", "2027-01-31"], "the moved entry stays where it moved");
  });
});
