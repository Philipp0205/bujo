import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

type Item = { id: string; date: string; type: string; horizon?: string; position: number; createdAt: number; isTrace?: boolean };
type Api = {
  migrate: { model: { open: (entries: Item[], today: string) => Item[]; tally: (decisions: string[]) => { kept: number; scheduled: number; dropped: number } } };
};

/** The pure scripts, loaded the way a page loads them: each one hangs itself on window.BujoLog. */
function load(): Api {
  const window: { BujoLog?: unknown } = {};
  const context = vm.createContext({ window, Object, Array, Math, JSON, String, Number });
  for (const file of ["dates", "days", "migrate/model"]) {
    vm.runInContext(readFileSync(new URL(`../public/js/log/${file}.js`, import.meta.url), "utf8"), context);
  }
  return window.BujoLog as Api;
}

const M = load().migrate.model;
const TODAY = "2026-11-23";
const item = (id: string, date: string, over: Partial<Item> = {}): Item => ({ id, date, type: "task", horizon: "day", position: 0, createdAt: 1, ...over });
const ids = (list: Item[]) => list.map((entry) => entry.id);

test("the review asks about open daily tasks of days before today, oldest day first, then by position", () => {
  const list = [
    item("late", "2026-11-22", { position: 0 }),
    item("b", "2026-11-20", { position: 1 }),
    item("a", "2026-11-20", { position: 0 }),
    item("today", TODAY),
    item("future-day", "2026-11-25"),
  ];
  assert.deepEqual(ids(M.open(list, TODAY)), ["a", "b", "late"]);
});

test("there is no day cap: a task a month or a year old is reviewed too", () => {
  const list = [item("month", "2026-10-20"), item("year", "2025-11-23"), item("week", "2026-11-16")];
  assert.deepEqual(ids(M.open(list, TODAY)), ["year", "month", "week"]);
});

test("done, notes, events, moved, scheduled and dropped marks, traces, calendar rows, month tasks and future items are not reviewed", () => {
  const earlier = "2026-11-20";
  const list = [
    ...["done", "note", "event", "migrated", "scheduled", "dropped"].map((type) => item(type, earlier, { type })),
    item("trace", earlier, { isTrace: true }),
    item("calendar", earlier, { horizon: "month-calendar" }),
    item("month", "2026-11-30", { horizon: "month-task" }),
    item("future", "2026-01-31", { horizon: "future" }),
    item("legacy", earlier, { horizon: undefined }),
  ];
  assert.deepEqual(ids(M.open(list, TODAY)), ["legacy"]);
});

test("tally counts kept, scheduled and dropped", () => {
  assert.deepEqual({ ...M.tally(["kept", "dropped", "kept", "scheduled", "kept"]) }, { kept: 3, scheduled: 1, dropped: 1 });
  assert.deepEqual({ ...M.tally([]) }, { kept: 0, scheduled: 0, dropped: 0 });
});
