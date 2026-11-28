import assert from "node:assert/strict";
import test from "node:test";
import { demoSource } from "../src/caldav/source.ts";
import { matchNote } from "../src/log/scan/note-match.ts";
import { createOcrClient } from "../src/scan/ocr-client.ts";
import { line, startFakeOcr } from "./fake-ocr.ts";
import { api, signUp, withApp } from "./helpers.ts";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const GARDEN = "# Kuechengarten\n- Beet 2: Rucola saeen\n- Tomaten giessen\n- Basilikum ernten";
const note = (id: string, title: string, body: string | null) => ({ id, title, date: "2026-11-10", body });
const scan = (title: string, body: string) => ({ title, date: "2026-11-20", dateFromPage: false, body });

test("matchNote: the same title and a similar body match, and the answer carries what the review needs", () => {
  const found = matchNote(scan("Kuechengarten", GARDEN.replace("saeen", "saen")), [note("a", "Kuechengarten", GARDEN), note("b", "Steuer", "- Belege")]);
  assert.deepEqual(found, { id: "a", title: "Kuechengarten", date: "2026-11-10", body: GARDEN });
});

test("matchNote: a reworded title with a near-identical body still matches", () => {
  const found = matchNote(scan("Garten im Fruehjahr", GARDEN), [note("a", "Kuechengarten", GARDEN), note("b", "Steuer", "- Belege sammeln")]);
  assert.equal(found?.id, "a");
});

test("matchNote: an empty title falls back to the body", () => {
  assert.equal(matchNote(scan("", GARDEN), [note("a", "Kuechengarten", GARDEN)])?.id, "a");
  assert.equal(matchNote(scan("", GARDEN), [note("a", "", "Ganz etwas anderes")]), null);
});

test("matchNote: unrelated notes and an empty list give null", () => {
  assert.equal(matchNote(scan("Reiseplan", "- Zug buchen\n- Hotel suchen"), [note("a", "Kuechengarten", GARDEN), note("b", "Steuer", null)]), null);
  assert.equal(matchNote(scan("Reiseplan", "- Zug buchen"), []), null);
});

test("matchNote: two near-equal candidates are ambiguous, so null", () => {
  assert.equal(matchNote(scan("Kuechengarten", GARDEN), [note("a", "Kuechengarten", GARDEN), note("b", "Kuechengarten", GARDEN)]), null);
});

test("POST /api/log/scan/note: answers match for a saved note of the user and null for a new page", async () => {
  const ocr = await startFakeOcr([]);
  try {
    await withApp(demoSource(), async ({ base }) => {
      const signed = await signUp(base);
      const post = (headers: Record<string, string>) =>
        fetch(`${base}/api/log/scan/note`, { method: "POST", headers: { "content-type": "image/png", ...headers }, body: new Uint8Array(PNG) }).then((r) => r.json());
      const lines = [line("none", "# Kuechengarten"), line("•", "Beet 2: Rucola saeen"), line("•", "Tomaten giessen"), line("•", "Basilikum ernten")];
      ocr.setLines(lines);
      assert.equal((await post(signed.headers)).match, null);

      const created = await api(base, "POST", "/api/entries", { headers: signed.headers, body: { date: "2026-11-10", type: "note", title: "Kuechengarten", body: GARDEN } });
      assert.equal(created.status, 201);
      const id = created.json.entry.id;
      assert.deepEqual((await post(signed.headers)).match, { id, title: "Kuechengarten", date: "2026-11-10", body: GARDEN });

      ocr.setLines([line("none", "Reiseplan"), line("•", "Zug buchen")]);
      assert.equal((await post(signed.headers)).match, null);
      const list = await api(base, "GET", "/api/entries?from=2026-11-01&to=2026-11-30", { headers: signed.headers });
      assert.equal(list.json.entries.length, 0, "a free note is not on the day list");
      const notes = await api(base, "GET", "/api/entries?kind=notes", { headers: signed.headers });
      assert.equal(notes.json.entries.length, 1, "the scan wrote nothing");
    }, { ocr: createOcrClient(ocr.url, { timeoutMs: 1500 }) });
  } finally {
    await ocr.close();
  }
});
