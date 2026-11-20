import assert from "node:assert/strict";
import test from "node:test";
import { demoSource } from "../src/caldav/source.ts";
import { createOcrClient } from "../src/scan/ocr-client.ts";
import { line, startFakeOcr, type FakeOcr } from "./fake-ocr.ts";
import { api, makeToken, signUp, withApp, type Signed } from "./helpers.ts";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const DAY = "2026-11-20";

type Ctx = { base: string; ocr: FakeOcr; signed: Signed };

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

async function scan(base: string, headers: Record<string, string>, query = "", body: Buffer = PNG, type = "image/png") {
  const response = await fetch(`${base}/api/log/scan${query}`, { method: "POST", headers: { "content-type": type, ...headers }, body: new Uint8Array(body) });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : undefined };
}

const entriesOf = async (base: string, signed: Signed, date = DAY) =>
  (await api(base, "GET", `/api/entries?from=${date}&to=${date}`, { headers: signed.headers })).json.entries as Array<{ id: string; type: string; title: string; tag: string | null }>;

const PAGE = [line("none", "20.11.2026"), line("•", "Brot kaufen", 0.94), line("○", "Lunch with Mira", 0.71), line("x", "Water the plants", 0.91)];

test("POST /api/log/scan: reads the page, answers a review and writes nothing", async () => {
  await withLogScan(async ({ base, ocr, signed }) => {
    ocr.setLines(PAGE);
    const { status, json } = await scan(base, signed.headers, "?date=2026-11-19");
    assert.equal(status, 201);
    assert.equal(json.draft.date, DAY);
    assert.equal(json.draft.pageDate, DAY);
    assert.equal(json.draft.fallbackDate, "2026-11-19");
    assert.deepEqual(json.draft.items.map((i: any) => [i.id, i.type, i.title, i.status, i.include]), [
      ["l2", "task", "Brot kaufen", "new", true],
      ["l3", "event", "Lunch with Mira", "new", true],
      ["l4", "done", "Water the plants", "new", true],
    ]);
    assert.equal(JSON.stringify(json).includes("userId"), false);
    assert.equal(ocr.requests.length, 1);
    assert.deepEqual(await entriesOf(base, signed), []);
  });
});

test("POST /api/log/scan: with no page date the day comes from ?date= and a bad ?date= is a 400", async () => {
  await withLogScan(async ({ base, ocr, signed }) => {
    ocr.setLines([line("•", "Brot kaufen")]);
    const ok = await scan(base, signed.headers, "?date=2026-11-18");
    assert.equal(ok.status, 201);
    assert.equal(ok.json.draft.date, "2026-11-18");
    assert.equal(ok.json.draft.pageDate, null);
    assert.equal((await scan(base, signed.headers, "?date=2026-13-40")).status, 400);
  });
});

test("POST /api/log/scan: needs a browser session, a photo type, and a working OCR", async () => {
  await withLogScan(async ({ base, ocr, signed }) => {
    ocr.setLines(PAGE);
    assert.equal((await scan(base, {})).status, 401);
    assert.equal((await scan(base, { cookie: "bujo_session=nope" })).status, 401);
    const token = (await makeToken(base, signed, "write")).token;
    assert.equal((await scan(base, { authorization: `Bearer ${token}` })).status, 403, "a token is not a browser session");
    assert.equal((await scan(base, signed.headers, "", Buffer.from("x"), "text/plain")).status, 415);
    assert.equal((await scan(base, signed.headers, "", Buffer.alloc(0))).status, 400);
    assert.equal((await api(base, "GET", "/api/log/scan", { headers: signed.headers })).status, 405);
    assert.equal(ocr.requests.length, 0, "a refused request never reaches OCR");
    ocr.failWith(500);
    assert.equal((await scan(base, signed.headers)).status, 502);
    assert.equal(ocr.requests.length, 1);
  });
});

test("apply: writes only the kept lines with their edits, marks an x line's task done, and runs once", async () => {
  await withLogScan(async ({ base, ocr, signed }) => {
    const task = await api(base, "POST", "/api/entries", { body: { date: DAY, type: "task", title: "Water the plants" }, headers: signed.headers });
    ocr.setLines(PAGE);
    const draft = (await scan(base, signed.headers)).json.draft;
    assert.equal(draft.items[2].status, "completes");
    assert.equal(draft.items[2].target.id, task.json.entry.id);

    const sent = {
      date: DAY,
      items: [
        { id: "l2", type: "note", title: "  Brot kaufen, Vollkorn ", tag: " Haushalt " },
        { id: "l4", type: "done", title: "Water the plants", tag: null },
      ],
    };
    const applied = await api(base, "POST", `/api/log/scan/${draft.id}/apply`, { body: sent, headers: signed.headers });
    assert.equal(applied.status, 200);
    assert.deepEqual(applied.json.results.map((r: any) => [r.id, r.outcome]), [["l2", "created"], ["l4", "completed"]]);

    const entries = await entriesOf(base, signed);
    assert.equal(entries.length, 2, "the line that completes a task adds no entry");
    assert.deepEqual(entries.map((e) => [e.type, e.title, e.tag]), [["done", "Water the plants", null], ["note", "Brot kaufen, Vollkorn", "Haushalt"]]);
    assert.equal(entries.some((e) => e.title === "Lunch with Mira"), false, "a line that was not sent is not written");

    const again = await api(base, "POST", `/api/log/scan/${draft.id}/apply`, { body: sent, headers: signed.headers });
    assert.equal(again.status, 409);
    assert.equal((await entriesOf(base, signed)).length, 2);
  });
});

test("check: tells the review about another day without writing, and a bad request is a 400", async () => {
  await withLogScan(async ({ base, ocr, signed }) => {
    await api(base, "POST", "/api/entries", { body: { date: "2026-11-21", type: "note", title: "Brot kaufen" }, headers: signed.headers });
    ocr.setLines(PAGE);
    const draft = (await scan(base, signed.headers)).json.draft;
    const body = { date: "2026-11-21", items: [{ id: "l2", type: "task", title: "Brot kaufen" }] };
    const checked = await api(base, "POST", `/api/log/scan/${draft.id}/check`, { body, headers: signed.headers });
    assert.equal(checked.status, 200);
    assert.deepEqual(checked.json, { date: "2026-11-21", items: [{ id: "l2", status: "duplicate", target: null }] });
    assert.equal((await entriesOf(base, signed, "2026-11-21")).length, 1);
    assert.equal((await api(base, "POST", `/api/log/scan/${draft.id}/check`, { body: { ...body, date: "nope" }, headers: signed.headers })).status, 400);
  });
});

test("apply: a bad request writes nothing at all", async () => {
  await withLogScan(async ({ base, ocr, signed }) => {
    ocr.setLines(PAGE);
    const draft = (await scan(base, signed.headers)).json.draft;
    const good = { id: "l2", type: "task", title: "Brot kaufen" };
    const bads: unknown[] = [
      { date: DAY, items: [] },
      { date: DAY, items: [good, { id: "l3", type: "event", title: "" }] },
      { date: DAY, items: [good, { id: "l3", type: "event", title: "x".repeat(201) }] },
      { date: DAY, items: [good, { id: "l9", type: "task", title: "Unbekannt" }] },
      { date: DAY, items: [good, good] },
      { date: DAY, items: [good, { id: "l3", type: "flag", title: "Falscher Typ" }] },
      { date: DAY, items: [{ ...good, extra: 1 }] },
      { date: DAY, items: [good], more: true },
      { date: "2026-02-30", items: [good] },
      { date: DAY, items: "nope" },
      { date: DAY, items: Array.from({ length: 201 }, () => good) },
    ];
    for (const body of bads) {
      const result = await api(base, "POST", `/api/log/scan/${draft.id}/apply`, { body, headers: signed.headers });
      assert.equal(result.status, 400, JSON.stringify(body).slice(0, 80));
    }
    assert.deepEqual(await entriesOf(base, signed), []);
    const fine = await api(base, "POST", `/api/log/scan/${draft.id}/apply`, { body: { date: DAY, items: [good] }, headers: signed.headers });
    assert.equal(fine.status, 200, "a draft that failed validation can still be applied");
  });
});

test("apply: an unknown draft is a 404, signed-out is a 401, an unknown step is a 404 and a GET is a 405", async () => {
  await withLogScan(async ({ base, ocr, signed }) => {
    ocr.setLines(PAGE);
    const draft = (await scan(base, signed.headers)).json.draft;
    const body = { date: DAY, items: [{ id: "l2", type: "task", title: "Brot kaufen" }] };
    assert.equal((await api(base, "POST", "/api/log/scan/nope/apply", { body, headers: signed.headers })).status, 404);
    assert.equal((await api(base, "POST", `/api/log/scan/${draft.id}/apply`, { body })).status, 401);
    assert.equal((await api(base, "POST", `/api/log/scan/${draft.id}/other`, { body, headers: signed.headers })).status, 404);
    assert.equal((await api(base, "GET", `/api/log/scan/${draft.id}/apply`, { headers: signed.headers })).status, 405);
  });
});
