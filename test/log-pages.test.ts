import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const PUBLIC_DIR = path.join(import.meta.dirname, "..", "public");
const TODAY = "2026-11-22";

type Pages = {
  sequence(entries: { date: string }[], today: string): string[];
  numberOf(days: string[], date: string): number;
  neighbours(days: string[], date: string): { prev: string | null; next: string | null };
  settle(days: string[], wanted: string | null, today: string): string;
  readDay(text: unknown, today: string): string | null;
  shiftMonth(month: string, n: number): string;
  monthRange(month: string): { from: string; to: string };
  monthWeeks(month: string): (string | null)[][];
  pickable(date: string, marks: Record<string, boolean>, today: string): boolean;
  marksOf(entries: { date: string }[]): Record<string, boolean>;
  within(range: { from: string; to: string }, date: string): boolean;
};

/** Loads dates.js and pages/model.js into one sandbox and returns what the pages model adds to window.BujoLog.pages. */
function loadModel(): Pages {
  const window: Record<string, any> = {};
  for (const file of [["dates.js"], ["pages", "model.js"]]) {
    vm.runInNewContext(fs.readFileSync(path.join(PUBLIC_DIR, "js", "log", ...file), "utf8"), { window });
  }
  return window.BujoLog.pages.model;
}

/** Compares by value: arrays made inside the vm sandbox have another prototype, so strict deepEqual would refuse them. */
function same(actual: unknown, expected: unknown): void {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));
}

const on = (...dates: string[]) => dates.map((date) => ({ date }));

test("pages: today is a page even when it has no entries, and it is the only page of an empty log", () => {
  const pages = loadModel();
  same(pages.sequence([], TODAY), [TODAY]);
  same(pages.sequence(on("2026-11-20", "2026-11-24"), TODAY), ["2026-11-20", TODAY, "2026-11-24"]);
});

test("pages: days without entries are left out, and a day with many entries is one page", () => {
  const pages = loadModel();
  const days = pages.sequence(on("2026-11-18", "2026-11-18", "2026-11-18", "2026-11-22", "2026-11-25"), TODAY);
  same(days, ["2026-11-18", TODAY, "2026-11-25"]);
});

test("pages: numbers are 1-based, follow the date order, and do not depend on the entry order", () => {
  const pages = loadModel();
  const days = pages.sequence(on("2026-11-25", "2026-11-18", "2026-11-20"), TODAY);
  same(days, ["2026-11-18", "2026-11-20", TODAY, "2026-11-25"]);
  assert.equal(pages.numberOf(days, "2026-11-18"), 1);
  assert.equal(pages.numberOf(days, TODAY), 3);
  assert.equal(pages.numberOf(days, "2026-11-25"), 4);
  assert.equal(pages.numberOf(days, "2026-11-19"), 0);
  assert.equal(pages.numberOf(pages.sequence(on("2026-11-25", "2026-11-18", "2026-11-20"), TODAY), TODAY), 3);
});

test("pages: previous and next skip the days without entries", () => {
  const pages = loadModel();
  const days = pages.sequence(on("2026-11-16", "2026-11-25"), TODAY);
  same(pages.neighbours(days, "2026-11-16"), { prev: null, next: TODAY });
  same(pages.neighbours(days, TODAY), { prev: "2026-11-16", next: "2026-11-25" });
  same(pages.neighbours(days, "2026-11-25"), { prev: TODAY, next: null });
});

test("pages: the first and the last page have no neighbour on their outer side, and a lone page has none at all", () => {
  const pages = loadModel();
  same(pages.neighbours([TODAY], TODAY), { prev: null, next: null });
  const days = pages.sequence(on("2026-11-20"), TODAY);
  assert.equal(pages.neighbours(days, days[0]).prev, null);
  assert.equal(pages.neighbours(days, days[days.length - 1]).next, null);
});

test("pages: adding a day with entries renumbers the pages after it", () => {
  const pages = loadModel();
  const before = pages.sequence(on("2026-11-20"), TODAY);
  assert.equal(pages.numberOf(before, TODAY), 2);
  const after = pages.sequence(on("2026-11-20", "2026-11-18"), TODAY);
  assert.equal(pages.numberOf(after, "2026-11-18"), 1);
  assert.equal(pages.numberOf(after, "2026-11-20"), 2);
  assert.equal(pages.numberOf(after, TODAY), 3);
});

test("pages: a page whose entries are gone falls back to the page before it, else the one after, else today", () => {
  const pages = loadModel();
  const days = pages.sequence(on("2026-11-18", "2026-11-25"), TODAY);
  assert.equal(pages.settle(days, "2026-11-20", TODAY), "2026-11-18");
  assert.equal(pages.settle(days, "2026-11-10", TODAY), "2026-11-18");
  assert.equal(pages.settle(days, "2026-11-25", TODAY), "2026-11-25");
  assert.equal(pages.settle(days, null, TODAY), TODAY);
});

test("pages: ?day= takes a real day near today and nothing else", () => {
  const pages = loadModel();
  assert.equal(pages.readDay("2026-11-18", TODAY), "2026-11-18");
  assert.equal(pages.readDay("2026-11-31", TODAY), null);
  assert.equal(pages.readDay("2026-1-5", TODAY), null);
  assert.equal(pages.readDay("tomorrow", TODAY), null);
  assert.equal(pages.readDay("", TODAY), null);
  assert.equal(pages.readDay(null, TODAY), null);
  assert.equal(pages.readDay("2020-01-01", TODAY), null);
  assert.equal(pages.readDay("2030-01-01", TODAY), null);
});

test("pages: a month grid starts on Monday, has whole weeks, and holds every day once", () => {
  const pages = loadModel();
  const weeks = pages.monthWeeks("2026-11");
  assert.ok(weeks.every((week) => week.length === 7));
  // 1 November 2026 is a Sunday, so it closes the first Monday-first week.
  same(weeks[0].slice(0, 6), [null, null, null, null, null, null]);
  assert.equal(weeks[0][6], "2026-11-01");
  const days = weeks.flat().filter(Boolean);
  assert.equal(days.length, 30);
  assert.equal(days[0], "2026-11-01");
  assert.equal(days[29], "2026-11-30");
});

test("pages: months shift across the year and report their first and last day", () => {
  const pages = loadModel();
  assert.equal(pages.shiftMonth("2026-12", 1), "2027-01");
  assert.equal(pages.shiftMonth("2026-01", -1), "2025-12");
  assert.equal(pages.shiftMonth("2026-11", 0), "2026-11");
  same(pages.monthRange("2028-02"), { from: "2028-02-01", to: "2028-02-29" });
});

test("pages: a day is inside a range at both of its ends and outside past them", () => {
  const pages = loadModel();
  const range = { from: "2026-11-16", to: "2026-11-29" };
  assert.equal(pages.within(range, "2026-11-16"), true);
  assert.equal(pages.within(range, "2026-11-29"), true);
  assert.equal(pages.within(range, "2026-11-15"), false);
  assert.equal(pages.within(range, "2026-11-30"), false);
});

test("pages: the picker lets a person choose today and days with entries, never an empty day", () => {
  const pages = loadModel();
  const marks = pages.marksOf(on("2026-11-18"));
  assert.equal(pages.pickable(TODAY, marks, TODAY), true);
  assert.equal(pages.pickable("2026-11-18", marks, TODAY), true);
  assert.equal(pages.pickable("2026-11-19", marks, TODAY), false);
});
