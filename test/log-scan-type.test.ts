import assert from "node:assert/strict";
import test from "node:test";
import { buildLogDraft } from "../src/log/scan/draft.ts";
import { guessType } from "../src/log/scan/type.ts";
import { line } from "./fake-ocr.ts";

const NOW = "2026-11-20";

test("guessType: a page headed by something that is not a date is a note or collection, even with bullets under it", () => {
  assert.deepEqual(guessType([line("none", "Books to read"), line("•", "Dune"), line("•", "Solaris")], NOW), { type: "note", source: "title" });
  assert.deepEqual(guessType([line("none", "# Küchengarten"), line("none", "Next: sketch a plan.")], NOW), { type: "note", source: "title" });
});

test("guessType: a page with no bullet at all is a note", () => {
  assert.deepEqual(guessType([line("none", "   "), line("none", "just prose")], NOW), { type: "note", source: "title" });
  assert.deepEqual(guessType([], NOW), { type: "note", source: "plain" });
});

test("guessType: a dated page, a month page and a page of bullet lines are logs", () => {
  assert.deepEqual(guessType([line("none", "20.11.2026"), line("•", "Brot")], NOW), { type: "log", source: "structure" });
  assert.deepEqual(guessType([line("none", "Dezember"), line("•", "Geschenke kaufen")], NOW), { type: "log", source: "structure" });
  assert.deepEqual(guessType([line("•", "Brot"), line("○", "Arzt"), line("none", "a stray line")], NOW), { type: "log", source: "bullets" });
});

test("a draft carries the guess, and the LLM's log kind does not turn a free page into a log", () => {
  const ocr = { lines: [line("none", "Packliste"), line("none", "Zelt und Schlafsack")], width: 1, height: 1, ms: 0, kind: "daily" };
  const draft = buildLogDraft({ ocr, fallbackDate: NOW, now: 0, ttlMs: 1000 });
  assert.deepEqual(draft.guess, { type: "note", source: "title" });
  assert.equal(draft.detected.kind, "daily");
});
