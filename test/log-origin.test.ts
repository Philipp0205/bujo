import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { originOf } from "../src/log/origin.ts";
import type { ScanSnapshot } from "../src/log/types.ts";

const snapshot: ScanSnapshot = { key: "milch kaufen", type: "task", title: "Milch kaufen", tags: [], time: null, at: 1000 };

test("origin: a stored scan origin with an untouched title is scan", () => {
  assert.equal(originOf("scan", { title: "Milch kaufen", updatedAt: 1000 }, snapshot), "scan");
});

test("origin: a later edit that keeps the title (done, tag, time) stays scan", () => {
  assert.equal(originOf("scan", { title: "Milch kaufen", updatedAt: 5000 }, snapshot), "scan");
  assert.equal(originOf("scan", { title: "milch  kaufen!", updatedAt: 5000 }, snapshot), "scan");
});

test("origin: a title changed in the app after the scan becomes app", () => {
  assert.equal(originOf("scan", { title: "Milch und Brot", updatedAt: 5000 }, snapshot), "app");
});

test("origin: nothing stored, or no snapshot, is app", () => {
  assert.equal(originOf(null, { title: "Milch kaufen", updatedAt: 1000 }, snapshot), "app");
  assert.equal(originOf("scan", { title: "Milch kaufen", updatedAt: 1000 }, null), "app");
});

type Number = { mapDays(pages: unknown[]): Record<string, number>; forDay(date: string): number };

/** Loads pages/number.js into a sandbox with a fake api and returns it. */
function loadNumber(): Number {
  const window: Record<string, any> = { BujoLog: { api: { listIndex: () => Promise.resolve([]) } } };
  const file = path.join(import.meta.dirname, "..", "public", "js", "log", "pages", "number.js");
  vm.runInNewContext(fs.readFileSync(file, "utf8"), { window });
  return window.BujoLog.pages.number;
}

test("page number: a day gets the number of its first physical page, other kinds and zero numbers are ignored", () => {
  const { mapDays, forDay } = loadNumber();
  const days = mapDays([
    { kind: "day", ref: "2026-11-18", page: 2, number: 13 },
    { kind: "day", ref: "2026-11-18", page: 1, number: 12 },
    { kind: "month", ref: "2026-11", page: 1, number: 3 },
    { kind: "day", ref: "2026-11-19", page: 1, number: 0 },
  ]);
  assert.deepEqual({ ...days }, { "2026-11-18": 12 });
  assert.equal(forDay("2026-11-18"), 0, "forDay reads the loaded index only, which is empty here");
});

test("page number: the aria label copy names the notebook page", () => {
  const window: Record<string, any> = {};
  vm.runInNewContext(fs.readFileSync(path.join(import.meta.dirname, "..", "public", "js", "log", "copy.js"), "utf8"), { window });
  assert.equal(window.BujoLog.copy.pages.notebookPage(12), "Notebook page 12");
});
