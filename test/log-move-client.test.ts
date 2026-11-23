import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

type Line = {
  id: string; isNew: boolean; home: string; homeHorizon: string; date: string; horizon: string; type: string; indent: number; trace: string | null;
};
type Place = { key: string; horizon: string; date: string };
type Pseudo = { id: string; isTrace: boolean; entryId: string; date: string; horizon: string; type: string; title: string };
type Item = { kind: "create" | "update"; id: string; body: Record<string, unknown> };
type Live = { id: string; date: string; horizon?: string; title: string };
type Api = {
  move: {
    model: {
      options: (line: Line, kind: string, today: string) => { here: boolean; next: Place | null; thisMonth: Place | null; months: Place[] };
      apply: (line: Line, kind: string, target: Place | null) => void;
      filedKey: (line: Line) => string | null;
      dayPlace: (date: string) => Place;
    };
    traces: {
      fromServer: (trace: Record<string, unknown>) => Pseudo;
      split: (list: unknown[]) => { entries: unknown[]; traces: Pseudo[] };
      withTraces: (entries: unknown[], traces: Pseudo[]) => unknown[];
      derive: (server: Pseudo[], live: Live[], items: Item[]) => Pseudo[];
      afterMove: (server: Pseudo[], before: Live, after: Live, kind: string | null) => Pseudo[];
      forget: (traces: Pseudo[], id: string) => Pseudo[];
    };
  };
  outbox: { model: { enqueueCreate: (...a: unknown[]) => Item[]; enqueueUpdate: (...a: unknown[]) => Item[]; preview: (entry: unknown, items: Item[]) => Record<string, unknown> } };
  days: { dayEntries: (list: unknown[], date: string) => Array<{ id: string }>; tracesOf: (list: unknown[], horizon: string, date: string) => Array<{ id: string }> };
};

/** The pure scripts, loaded the way a page loads them: each one hangs itself on window.BujoLog. */
function load(): Api {
  const window: { BujoLog?: unknown; crypto?: unknown } = { crypto: { getRandomValues: (bytes: Uint8Array) => bytes.fill(7) } };
  const context = vm.createContext({ window, Uint8Array, Date, Object, Array, Math, JSON, String, Number });
  for (const file of ["dates", "days", "move/traces", "pages/model", "horizon/model", "move/model", "outbox/model"]) {
    vm.runInContext(readFileSync(new URL(`../public/js/log/${file}.js`, import.meta.url), "utf8"), context);
  }
  return window.BujoLog as Api;
}

const L = load();
const M = L.move.model;
const T = L.move.traces;
/** A value from the page scripts as a plain object, so deepEqual does not trip on the other realm's prototypes. */
const plain = <V>(value: V): V => JSON.parse(JSON.stringify(value));
const TODAY = "2026-11-23";
const line = (over: Partial<Line> = {}): Line => ({
  id: "a", isNew: false, home: TODAY, homeHorizon: "day", date: TODAY, horizon: "day", type: "task", indent: 1, trace: null, ...over,
});
const live = (over: Partial<Live> = {}): Live => ({ id: "a", date: TODAY, title: "Alt", ...over });

test("options: a day entry may go to the next day, this month, or one of the five later months", () => {
  const choices = M.options(line(), "migrate", TODAY);
  assert.equal(choices.here, false);
  assert.equal(choices.next!.key, "day:2026-11-24");
  assert.equal(choices.thisMonth!.key, "month:2026-11");
  assert.deepEqual(plain(choices.months.map((place) => place.key)), ["month:2026-12", "month:2027-01", "month:2027-02", "month:2027-03", "month:2027-04"]);
});

test("options: a schedule on a day offers This day, and the month places are dated by the last day (February too)", () => {
  const choices = M.options(line(), "schedule", TODAY);
  assert.equal(choices.here, true);
  const feb = choices.months.find((place) => place.key === "month:2027-02")!;
  assert.deepEqual(plain(feb), { key: "month:2027-02", horizon: "future", date: "2027-02-28" });
  assert.deepEqual(plain(choices.thisMonth), { key: "month:2026-11", horizon: "month-task", date: "2026-11-30" });
});

test("options: from a month the next day is tomorrow, and the month the entry is in is left out", () => {
  const inMonth = line({ home: "2026-11-30", homeHorizon: "month-task", date: "2026-11-30", horizon: "month-task" });
  const choices = M.options(inMonth, "migrate", TODAY);
  assert.equal(choices.next!.key, "day:2026-11-24");
  assert.equal(choices.thisMonth, null);
  assert.equal(M.options(inMonth, "schedule", TODAY).here, false);
});

test("options: the next day of an old day is never in the past", () => {
  const old = line({ home: "2026-11-10", date: "2026-11-10" });
  assert.equal(M.options(old, "migrate", TODAY).next!.key, "day:2026-11-23");
  const future = line({ home: "2026-11-27", date: "2026-11-27" });
  assert.equal(M.options(future, "migrate", TODAY).next!.key, "day:2026-11-28");
});

test("apply: a migration to a day turns a moved or scheduled mark into a task, and asks for a > trace", () => {
  const moved = line({ type: "scheduled" });
  M.apply(moved, "migrate", M.dayPlace("2026-11-24"));
  assert.deepEqual({ date: moved.date, horizon: moved.horizon, type: moved.type, trace: moved.trace, indent: moved.indent }, {
    date: "2026-11-24", horizon: "day", type: "task", trace: "migrated", indent: 0,
  });
});

test("apply: a migration keeps a note, and a done entry's type, and an event stays an event until the server settles it", () => {
  for (const type of ["note", "event"]) {
    const entry = line({ type });
    M.apply(entry, "migrate", M.dayPlace("2026-11-24"));
    assert.equal(entry.type, type);
  }
});

test("apply: a schedule onto a day makes a scheduled mark, into a month a plain task, and asks for a < trace", () => {
  const onDay = line();
  M.apply(onDay, "schedule", M.dayPlace("2026-11-30"));
  assert.deepEqual({ type: onDay.type, horizon: onDay.horizon, trace: onDay.trace }, { type: "scheduled", horizon: "day", trace: "scheduled" });
  const intoMonth = line();
  M.apply(intoMonth, "schedule", { key: "month:2027-01", horizon: "future", date: "2027-01-31" });
  assert.deepEqual({ type: intoMonth.type, horizon: intoMonth.horizon, date: intoMonth.date, trace: intoMonth.trace }, {
    type: "task", horizon: "future", date: "2027-01-31", trace: "scheduled",
  });
});

test("apply: This day keeps the date and the page, sets the scheduled type, and leaves no trace", () => {
  const entry = line({ date: "2026-11-25", horizon: "day", trace: "scheduled" });
  M.apply(entry, "schedule", null);
  assert.deepEqual({ date: entry.date, type: entry.type, trace: entry.trace }, { date: TODAY, type: "scheduled", trace: null });
});

test("filedKey: a place a written @day or @month filed the line in is the pick, a line at home has none", () => {
  assert.equal(M.filedKey(line()), null);
  assert.equal(M.filedKey(line({ date: "2026-12-31", horizon: "future" })), "month:2026-12");
  assert.equal(M.filedKey(line({ date: "2026-11-28" })), "day:2026-11-28");
});

test("traces: a server trace becomes a pseudo entry, and split and withTraces take the list apart and join it", () => {
  const trace = T.fromServer({ id: "t1", entryId: "a", date: TODAY, horizon: "day", kind: "migrated", title: "Alt", createdAt: 5 });
  assert.deepEqual({ isTrace: trace.isTrace, type: trace.type, title: trace.title, entryId: trace.entryId }, { isTrace: true, type: "migrated", title: "Alt", entryId: "a" });
  const parts = T.split([live(), trace]);
  assert.equal(parts.entries.length, 1);
  assert.deepEqual(parts.traces, [trace]);
  assert.equal(T.withTraces(parts.entries, parts.traces).length, 2);
  assert.equal(T.withTraces(parts.entries, []), parts.entries);
});

test("traces: dayEntries leaves a trace out of the cards, and tracesOf finds it for its page only", () => {
  const trace = T.fromServer({ id: "t1", entryId: "a", date: TODAY, horizon: "day", kind: "migrated", title: "Alt" });
  const list = [live(), trace];
  assert.deepEqual(L.days.dayEntries(list, TODAY).map((entry) => entry.id), ["a"]);
  assert.deepEqual(L.days.tracesOf(list, "day", TODAY).map((found) => found.id), [trace.id]);
  assert.equal(L.days.tracesOf(list, "day", "2026-11-24").length, 0);
  assert.equal(L.days.tracesOf(list, "future", TODAY).length, 0);
});

test("derive: a queued move leaves a trace of the old page, once, and none for a move that stays on its page", () => {
  const moveItem: Item = { kind: "update", id: "a", body: { date: "2026-11-24", trace: "migrated" } };
  const traces = T.derive([], [live()], [moveItem]);
  assert.deepEqual(traces.map((trace) => [trace.entryId, trace.date, trace.type, trace.title]), [["a", TODAY, "migrated", "Alt"]]);
  assert.equal(T.derive(traces, [live()], [moveItem]).length, 1);
  assert.equal(T.derive([], [live()], [{ kind: "update", id: "a", body: { title: "x", trace: "migrated" } }]).length, 0);
  assert.equal(T.derive([], [live()], [{ kind: "create", id: "a", body: { date: "2026-11-24" } }]).length, 0);
});

test("derive: a queued move back to a page takes the trace of that page away", () => {
  const server = [T.fromServer({ id: "t1", entryId: "a", date: TODAY, horizon: "day", kind: "migrated", title: "Alt" })];
  const away = live({ date: "2026-11-24" });
  const back: Item = { kind: "update", id: "a", body: { date: TODAY } };
  assert.equal(T.derive(server, [away], [back]).length, 0);
});

test("afterMove: a move that went through adds the trace at once, a repeat does not, and arriving home clears it", () => {
  const before = live();
  const after = live({ date: "2026-12-31", horizon: "future" });
  const once = T.afterMove([], before, after, "scheduled");
  assert.deepEqual(once.map((trace) => [trace.date, trace.type]), [[TODAY, "scheduled"]]);
  assert.equal(T.afterMove(once, before, after, "scheduled").length, 1);
  assert.equal(T.afterMove(once, after, before, null).length, 0);
  assert.equal(T.afterMove([], before, live({ title: "same page" }), "migrated").length, 0);
});

test("forget: the traces of a deleted entry go, those of others stay", () => {
  const a = T.fromServer({ id: "t1", entryId: "a", date: TODAY, horizon: "day", kind: "migrated", title: "A" });
  const b = T.fromServer({ id: "t2", entryId: "b", date: TODAY, horizon: "day", kind: "migrated", title: "B" });
  assert.deepEqual(T.forget([a, b], "a"), [b]);
});

test("outbox: a trace never goes into a queued create, and the preview shows no trace key and an entry off paper", () => {
  const items = L.outbox.model.enqueueCreate([], { id: "a", date: TODAY, type: "task", title: "Neu", tags: [], time: null }, 0, "2026-11-23T10:00:00.000Z");
  const folded = L.outbox.model.enqueueUpdate(items, "a", { date: "2026-11-24", trace: "migrated" }, "2026-11-23T10:00:01.000Z");
  assert.equal(folded.length, 1);
  assert.equal("trace" in folded[0]!.body, false);
  assert.equal(folded[0]!.body.date, "2026-11-24");

  const queued = L.outbox.model.enqueueUpdate([], "b", { date: "2026-11-24", trace: "migrated" }, "2026-11-23T10:00:00.000Z");
  assert.equal(queued[0]!.body.trace, "migrated");
  const shown = L.outbox.model.preview({ id: "b", date: TODAY, onPaper: true }, queued);
  assert.equal("trace" in shown, false);
  assert.deepEqual({ date: shown.date, onPaper: shown.onPaper }, { date: "2026-11-24", onPaper: false });
});
