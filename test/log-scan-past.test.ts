import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const LOG_DIR = path.join(import.meta.dirname, "..", "public", "js", "log");

type Item = { include: boolean };
type Model = {
  fromDraft(draft: unknown): { items: Item[] };
  setClock(now: () => Date): void;
  isPast(item: Item): boolean;
  defaultInclude(item: Item): boolean;
};

/** Loads the scan model with the files it reads at call time (dates, tags) and returns it. */
function loadModel(): Model {
  const window: Record<string, any> = {};
  for (const file of ["dates.js", "tags.js", path.join("scan", "model.js")]) {
    vm.runInNewContext(fs.readFileSync(path.join(LOG_DIR, file), "utf8"), { window });
  }
  return window.BujoLog.scan.model;
}

const NOW = new Date(2026, 10, 15, 23, 59, 0);

function line(id: string, day: number | null, month?: string): Record<string, unknown> {
  return { id, type: "event", title: id, tags: [], confidence: 0.9, noBullet: false, status: "new", target: null, before: null, after: null, contested: false, include: true, day, month };
}

function draft(kind: string, lines: unknown[]): Record<string, unknown> {
  return { id: "d", kind, detected: { kind, source: "page" }, fallbackDate: "2026-11-15", month: "2026-11", items: lines };
}

test("past default: a calendar line before today starts unticked, today and later stay ticked, a no-day line stays off", () => {
  const model = loadModel();
  model.setClock(() => NOW);
  const noDay = { ...line("d", null), include: false };
  const state = model.fromDraft(draft("calendar", [line("a", 14), line("b", 15), line("c", 16), noDay]));
  assert.deepEqual(state.items.map((item) => model.isPast(item)), [true, false, false, false]);
  assert.deepEqual(state.items.map((item) => item.include), [false, true, true, false]);
  assert.equal(model.defaultInclude(state.items[0]), false);
  assert.equal(model.defaultInclude(state.items[1]), true);
  assert.equal(model.defaultInclude(state.items[3]), false);
});

test("past default: the day is the local day, so the clock decides at the day boundary", () => {
  const model = loadModel();
  model.setClock(() => new Date(2026, 10, 16, 0, 1, 0));
  const state = model.fromDraft(draft("calendar", [line("a", 15)]));
  assert.equal(model.isPast(state.items[0]), true);
});

test("past default: a future line is past only in an earlier month", () => {
  const model = loadModel();
  model.setClock(() => NOW);
  const state = model.fromDraft(draft("future", [line("a", null, "2026-10"), line("b", null, "2026-11"), line("c", null, "2027-01")]));
  assert.deepEqual(state.items.map((item) => item.include), [false, true, true]);
});

test("past default: a daily page is never past", () => {
  const model = loadModel();
  model.setClock(() => NOW);
  const state = model.fromDraft(draft("daily", [line("a", 1)]));
  assert.equal(model.isPast(state.items[0]), false);
  assert.equal(state.items[0].include, true);
});
