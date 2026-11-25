import assert from "node:assert/strict";
import test from "node:test";
import { demoSource } from "../src/caldav/source.ts";
import { buildLogDraft, startReview } from "../src/log/scan/draft.ts";
import { parsePage, type PageLine } from "../src/log/scan/parse.ts";
import { fixedReader } from "../src/log/scan/plan.ts";
import { parseReview } from "../src/log/scan/request.ts";
import { createOcrClient, type OcrLine } from "../src/scan/ocr-client.ts";
import { line, startFakeOcr, type FakeOcr } from "./fake-ocr.ts";
import { api, signUp, withApp, type Signed } from "./helpers.ts";

const TODAY = "2026-11-20";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** A synthetic OCR line, nested under the line above when `indent` is 1. */
const nest = (symbol: OcrLine["symbol"], text: string, indent: unknown = 1): OcrLine => ({ ...line(symbol, text, 0.9), indent: indent as number });
const MEETING = [line("none", "20.11.2026"), line("○", "Meeting with Anna"), nest("–", "Note 1"), nest("–", "Note 2"), nest("–", "Note 3")];
const indents = (lines: readonly { indent: number }[]) => lines.map((l) => l.indent);

// ----- parser -----

test("parsePage: a meeting with three indented notes nests the notes, the header and the meeting stay 0", () => {
  const page = parsePage(MEETING, TODAY);
  assert.deepEqual(page.lines.map((l) => [l.title, l.indent]), [["Meeting with Anna", 0], ["Note 1", 1], ["Note 2", 1], ["Note 3", 1]]);
});

test("parsePage: the first entry line and a line under the date header stay 0 even when the OCR says 1", () => {
  assert.deepEqual(indents(parsePage([nest("•", "Erste"), nest("•", "Zweite")], TODAY).lines), [0, 1]);
  const withHeader = parsePage([nest("none", "20.11.2026"), nest("•", "Erste"), nest("•", "Zweite")], TODAY);
  assert.equal(withHeader.pageDate, "2026-11-20");
  assert.deepEqual(indents(withHeader.lines), [0, 1]);
});

test("parsePage: a line under a line with no bullet stays 0", () => {
  assert.deepEqual(indents(parsePage([line("none", "Zwischenueberschrift"), nest("–", "darunter")], TODAY).lines), [0, 0]);
});

test("parsePage: deeper writing is one level: a note under a note is still 1", () => {
  const page = parsePage([line("•", "Task"), nest("–", "child"), nest("–", "grandchild")], TODAY);
  assert.deepEqual(indents(page.lines), [0, 1, 1]);
});

test("parsePage: a missing indent, or any value that is not 1, is 0", () => {
  const page = parsePage([line("•", "A"), line("–", "B"), nest("–", "C", 2), nest("–", "D", "1"), nest("–", "E", true), nest("–", "F", -1)], TODAY);
  assert.deepEqual(indents(page.lines), [0, 0, 0, 0, 0, 0]);
});

test("parsePage: future, calendar and month-task pages ignore indent", () => {
  const future: PageLine[] = [line("none", "Januar"), line("•", "Steuer"), nest("–", "Belege")];
  assert.deepEqual(indents(parsePage(future, TODAY, "future", "2027").lines), [0, 0]);
  const calendar: PageLine[] = [line("none", "November"), line("none", "5 Do Zahnarzt"), nest("–", "mitbringen")];
  assert.deepEqual(indents(parsePage(calendar, TODAY, "calendar", "2026-11").lines), [0, 0]);
  const month: PageLine[] = [line("none", "November"), line("•", "Steuer"), nest("•", "Belege")];
  assert.deepEqual(indents(parsePage(month, TODAY, "month-task", "2026-11").lines), [0, 0]);
});

// ----- draft and review -----

test("the draft keeps the indent of each line and the review carries it, without a box or photo", () => {
  const draft = buildLogDraft({ ocr: { lines: MEETING, width: 1, height: 1, ms: 1 }, fallbackDate: TODAY, now: 0, ttlMs: 1000 });
  assert.deepEqual(draft.page.map((l) => l.indent ?? 0), [0, 0, 1, 1, 1]);
  assert.equal("bbox" in draft.page[2], false);
  const review = startReview(draft, fixedReader([]));
  assert.deepEqual(indents(review.items), [0, 1, 1, 1]);
});

// ----- request -----

test("the apply request accepts indent 0 or 1, treats a missing one as 0 and refuses anything else", () => {
  const draft = buildLogDraft({ ocr: { lines: MEETING, width: 1, height: 1, ms: 1 }, fallbackDate: TODAY, now: 0, ttlMs: 1000 });
  const body = (indent?: unknown) => ({ date: TODAY, items: [{ id: "l2", type: "task", title: "x", ...(indent === undefined ? {} : { indent }) }] });
  assert.equal(parseReview(body(), draft).items[0].indent, 0);
  assert.equal(parseReview(body(1), draft).items[0].indent, 1);
  assert.equal(parseReview(body(0), draft).items[0].indent, 0);
  for (const bad of [2, -1, "1", true, null]) assert.throws(() => parseReview(body(bad), draft), (e: any) => e.status === 400 && /indent/.test(e.message));
});

// ----- OCR client -----

test("the OCR client: an answer without indent is valid, and anything that is not 1 reads as 0", async () => {
  const answer = (lines: unknown[]) => async () => new Response(JSON.stringify({ lines, width: 1, height: 1, ms: 1 }), { status: 200 });
  const raw = (extra: object) => ({ symbol: "–", text: "x", confidence: 0.9, engine: "fake", bbox: [0, 0, 1, 1], ...extra });
  const read = (lines: unknown[]) => createOcrClient("http://ocr.invalid", { fetch: answer(lines) as typeof fetch })(PNG, "image/png");
  const result = await read([raw({}), raw({ indent: 1 }), raw({ indent: 2 }), raw({ indent: "1" }), raw({ indent: true }), raw({ indent: null })]);
  assert.deepEqual(result.lines.map((l) => l.indent ?? 0), [0, 1, 0, 0, 0, 0]);
});

// ----- apply through the routes -----

type Ctx = { base: string; ocr: FakeOcr; signed: Signed };

async function withScan(fn: (ctx: Ctx) => Promise<void>): Promise<void> {
  const ocr = await startFakeOcr([]);
  try {
    await withApp(demoSource(), async ({ base }) => fn({ base, ocr, signed: await signUp(base) }), { ocr: createOcrClient(ocr.url, { timeoutMs: 1500 }) });
  } finally {
    await ocr.close();
  }
}

async function scan(ctx: Ctx, lines: OcrLine[]) {
  ctx.ocr.setLines(lines);
  const response = await fetch(`${ctx.base}/api/log/scan`, { method: "POST", headers: { "content-type": "image/png", ...ctx.signed.headers }, body: new Uint8Array(PNG) });
  return (await response.json()).draft;
}

const apply = (ctx: Ctx, draftId: string, items: object[]) =>
  api(ctx.base, "POST", `/api/log/scan/${draftId}/apply`, { body: { date: TODAY, items }, headers: ctx.signed.headers });

const day = async (ctx: Ctx) =>
  (await api(ctx.base, "GET", `/api/entries?from=${TODAY}&to=${TODAY}`, { headers: ctx.signed.headers })).json.entries as Array<{ id: string; title: string; indent: number; updatedAt: number }>;

const sendAll = (draft: { items: Array<{ id: string; type: string; title: string; indent?: number }> }, patch: Record<string, object> = {}) =>
  draft.items.map(({ id, type, title, indent }) => ({ id, type, title, indent: indent ?? 0, ...patch[id] }));

test("apply: the notes are saved nested under the meeting, in paper order", async () => {
  await withScan(async (ctx) => {
    const draft = await scan(ctx, MEETING);
    assert.deepEqual(draft.items.map((i: any) => i.indent), [0, 1, 1, 1]);
    assert.equal((await apply(ctx, draft.id, sendAll(draft))).status, 200);
    assert.deepEqual((await day(ctx)).map((e) => [e.title, e.indent]), [["Meeting with Anna", 0], ["Note 1", 1], ["Note 2", 1], ["Note 3", 1]]);
  });
});

test("apply: an unticked parent leaves the first child at 0 and the rest nested", async () => {
  await withScan(async (ctx) => {
    const draft = await scan(ctx, MEETING);
    const sent = sendAll(draft, { l2: { include: false } });
    assert.equal((await apply(ctx, draft.id, sent)).status, 200);
    assert.deepEqual((await day(ctx)).map((e) => [e.title, e.indent]), [["Note 1", 0], ["Note 2", 1], ["Note 3", 1]]);
  });
});

test("apply: the review can nest a line the OCR left flat, and un-nest one it nested", async () => {
  await withScan(async (ctx) => {
    const draft = await scan(ctx, MEETING);
    assert.equal((await apply(ctx, draft.id, sendAll(draft, { l3: { indent: 0 }, l4: { indent: 1 } }))).status, 200);
    assert.deepEqual((await day(ctx)).map((e) => e.indent), [0, 0, 1, 1]);
  });
});

test("rescan: the nesting stays, indent never makes a line edited, and unchanged lines stay unchanged", async () => {
  await withScan(async (ctx) => {
    const first = await scan(ctx, MEETING);
    await apply(ctx, first.id, sendAll(first));
    const saved = await day(ctx);

    const second = await scan(ctx, MEETING);
    assert.deepEqual(second.items.map((i: any) => [i.status, i.indent]), [["unchanged", 0], ["unchanged", 1], ["unchanged", 1], ["unchanged", 1]]);

    const edited = MEETING.map((l) => (l.text === "Note 2" ? { ...l, text: "Note 2 geaendert" } : l));
    const third = await scan(ctx, edited);
    assert.deepEqual(third.items.map((i: any) => i.status), ["unchanged", "unchanged", "edited", "unchanged"]);
    const kept = sendAll(third).map((item) => ({ ...item, include: true }));
    assert.equal((await apply(ctx, third.id, kept)).status, 200);
    const after = await day(ctx);
    assert.deepEqual(after.map((e) => [e.title, e.indent]), [["Meeting with Anna", 0], ["Note 1", 1], ["Note 2 geaendert", 1], ["Note 3", 1]]);
    assert.deepEqual(after.map((e) => e.updatedAt === saved.find((s) => s.id === e.id)!.updatedAt), [true, true, false, true], "only the edited line counts as an edit");
  });
});

test("apply: a page that is not daily files no indent", async () => {
  await withScan(async (ctx) => {
    const lines = [line("none", "Januar"), line("•", "Steuer"), nest("•", "Belege")];
    const draft = await scan(ctx, lines);
    const response = await api(ctx.base, "POST", `/api/log/scan/${draft.id}/apply`, {
      body: { kind: "future", items: draft.items.map((i: any) => ({ id: i.id, type: i.type, title: i.title, month: "2027-01", indent: 1 })) },
      headers: ctx.signed.headers,
    });
    assert.equal(response.status, 200);
    const future = await api(ctx.base, "GET", "/api/entries?from=2027-01-01&to=2027-01-31", { headers: ctx.signed.headers });
    assert.deepEqual(future.json.entries.map((e: any) => e.indent), [0, 0]);
  });
});
