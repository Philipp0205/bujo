import assert from "node:assert/strict";
import test from "node:test";
import { demoSource } from "../src/caldav/source.ts";
import { createOcrClient } from "../src/scan/ocr-client.ts";
import { line, startFakeOcr } from "./fake-ocr.ts";
import { api, withApp, signUp } from "./helpers.ts";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** Runs fn against an app with a fake OCR and the demo (in-memory) list: never a real Nextcloud list. */
async function withScan(lines: ReturnType<typeof line>[], fn: (c: { base: string; headers: Record<string, string> }) => Promise<void>): Promise<void> {
  const ocr = await startFakeOcr(lines);
  try {
    await withApp(demoSource(), async ({ base }) => {
      const signed = await signUp(base);
      await fn({ base, headers: signed.headers });
    }, { ocr: createOcrClient(ocr.url, { timeoutMs: 1500 }) });
  } finally {
    await ocr.close();
  }
}

async function scanAndApply(base: string, headers: Record<string, string>) {
  const response = await fetch(`${base}/api/log/scan?date=2026-11-20`, { method: "POST", headers: { "content-type": "image/png", ...headers }, body: new Uint8Array(PNG) });
  const review = (await response.json()).draft;
  const items = review.items.map((i: any) => ({ id: i.id, type: i.type, title: i.title, tags: i.tags, time: i.time, include: i.include }));
  const applied = await api(base, "POST", `/api/log/scan/${review.id}/apply`, { body: { kind: review.kind, date: review.date, items }, headers });
  return { review, applied };
}

const entries = async (base: string, headers: Record<string, string>) =>
  (await api(base, "GET", "/api/entries?from=2026-11-01&to=2026-11-30", { headers })).json.entries as Array<{ id: string; type: string; title: string }>;

test("the OCR client leaves struck-through (~) lines out and keeps every other symbol", async () => {
  const raw = (symbol: string, text: string) => ({ symbol, text, confidence: 0.9, engine: "fake", bbox: [0, 0, 1, 1] });
  const lines = [raw("none", "20.11.2026"), raw("~", "Alte Idee"), raw("x", "Plants"), raw("•", "Brot"), raw(">", "Moved"), raw("<", "Sched"), raw("○", "Meet"), raw("–", "Note")];
  const fetcher = (async () => new Response(JSON.stringify({ lines, width: 1, height: 1, ms: 1 }), { status: 200 })) as typeof fetch;
  const result = await createOcrClient("http://ocr.invalid", { fetch: fetcher })(PNG, "image/png");
  assert.deepEqual(result.lines.map((l) => l.symbol), ["none", "x", "•", ">", "<", "○", "–"]);
});

test("scan struck: a ~ line is not in the review and applies nothing", async () => {
  await withScan([line("none", "20.11.2026"), line("~", "Alte Idee", 0.8, 1), line("x", "Plants", 0.9, 2)], async ({ base, headers }) => {
    const { review, applied } = await scanAndApply(base, headers);
    assert.deepEqual(review.items.map((i: any) => [i.type, i.title]), [["done", "Plants"]]);
    assert.equal(applied.status, 200);
    assert.deepEqual((await entries(base, headers)).map((e) => [e.type, e.title]), [["done", "Plants"]]);
  });
});

test("scan struck: a ~ line equal to an open task leaves that task untouched and creates nothing", async () => {
  await withScan([line("none", "20.11.2026"), line("~", "Brot kaufen", 0.9, 1), line("x", "Plants", 0.9, 2)], async ({ base, headers }) => {
    const made = await api(base, "POST", "/api/entries", { body: { date: "2026-11-20", horizon: "day", type: "task", title: "Brot kaufen" }, headers });
    const id = made.json.entry.id;
    const { review, applied } = await scanAndApply(base, headers);
    assert.deepEqual(review.items.map((i: any) => i.title), ["Plants"]);
    assert.equal(applied.status, 200);
    const after = (await entries(base, headers)).map((e) => [e.type, e.title]).sort();
    assert.deepEqual(after, [["done", "Plants"], ["task", "Brot kaufen"]]);
    assert.equal((await entries(base, headers)).find((e) => e.title === "Brot kaufen")!.id, id);
  });
});
