import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const PUBLIC_DIR = path.join(import.meta.dirname, "..", "public");
/** A Sunday, in November 2026. */
const TODAY = "2026-11-22";

type Entry = { id?: string; date: string; horizon?: string; type?: string; position?: number; createdAt?: number; indent?: number };
type Line = {
  isNew: boolean; home: string; homeHorizon: string; date: string; horizon: string; type: string; title: string; tags: string[]; time: string | null;
  indent: number; original: Entry | null; edited: boolean;
};
type Loaded = {
  horizon: {
    futureMonths(today: string): string[];
    span(today: string): { from: string; to: string };
    lastDay(month: string): string;
    readMonth(text: unknown, today: string): string | null;
    slotOf(view: string, month: string, today: string, page?: number): { date: string; horizon: string };
    monthDays(entries: Entry[], month: string): Array<{ date: string; entries: Entry[] }>;
    monthPages(today: string): Array<{ month: string; part: string }>;
    monthStep(page: { month: string; part: string }, n: number, today: string): { month: string; part: string } | null;
    buckets(entries: Entry[], today: string): Array<{ month: string; cards: Array<{ entry: Entry }> }>;
    futurePages(entries: Entry[], today: string): Array<Array<{ month: string }>>;
    futureStep(page: number, n: number): { page: number } | null;
  };
  inline: {
    blank(slot: { date: string; horizon: string }): Line;
    fromEntry(entry: Entry & { type: string; title: string }): Line;
    absorb(line: Line, text: string, opts: { final: boolean; today: string; known?: unknown[] }): boolean;
    moved(line: Line): boolean;
    changes(line: Line): Record<string, unknown>;
  };
  days: { editPills(line: Line): Array<{ kind: string; text: string }> };
};

/** The browser modules, loaded the way a page loads them: scripts that hang themselves on one window.BujoLog. */
function load(): Loaded {
  const window: Record<string, any> = {};
  const files = [
    "copy.js", "dates.js", "date-token.js", "markup.js", "tags.js", "days.js", "pages/model.js", "horizon/model.js", "inline/model.js"
  ];
  for (const file of files) {
    vm.runInNewContext(fs.readFileSync(path.join(PUBLIC_DIR, "js", "log", file), "utf8"), { window });
  }
  const log = window.BujoLog;
  return { horizon: log.horizon.model, inline: log.inline.model, days: log.days };
}

/** Results come out of another realm, so compare them as JSON. */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const M = load();

test("horizon: the Future Log is this month and the five after it", () => {
  assert.deepEqual(plain(M.horizon.futureMonths(TODAY)), ["2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04"]);
});

test("horizon: the read span is the first of this month through the end of the sixth, inside the 200 day cap", () => {
  assert.deepEqual(plain(M.horizon.span(TODAY)), { from: "2026-11-01", to: "2027-04-30" });
  for (const today of ["2026-01-31", "2026-07-01", "2027-08-15", "2028-02-29"]) {
    const { from, to } = M.horizon.span(today);
    const days = (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;
    assert.ok(days <= 200, `${today}: ${days} days`);
  }
});

test("horizon: the last day of a month is the date of its month items", () => {
  assert.equal(M.horizon.lastDay("2026-12"), "2026-12-31");
  assert.equal(M.horizon.lastDay("2028-02"), "2028-02-29");
});

test("horizon: a ?month= link is read only for the six months", () => {
  assert.equal(M.horizon.readMonth("2027-03", TODAY), "2027-03");
  assert.equal(M.horizon.readMonth("2027-05", TODAY), null);
  assert.equal(M.horizon.readMonth("2026-10", TODAY), null);
  assert.equal(M.horizon.readMonth("2026-13", TODAY), null);
  assert.equal(M.horizon.readMonth(null, TODAY), null);
});

test("horizon: the month pages turn calendar, tasks, next month's calendar, and stop at both ends", () => {
  const pages = plain(M.horizon.monthPages(TODAY));
  assert.equal(pages.length, 12);
  assert.deepEqual(pages[0], { month: "2026-11", part: "calendar" });
  assert.deepEqual(pages[11], { month: "2027-04", part: "tasks" });
  const step = (month: string, part: string, n: number) => plain(M.horizon.monthStep({ month, part }, n, TODAY));
  assert.deepEqual(step("2026-11", "calendar", 1), { month: "2026-11", part: "tasks" });
  assert.deepEqual(step("2026-11", "tasks", 1), { month: "2026-12", part: "calendar" });
  assert.deepEqual(step("2026-12", "calendar", -1), { month: "2026-11", part: "tasks" });
  assert.equal(step("2026-11", "calendar", -1), null);
  assert.equal(step("2027-04", "tasks", 1), null);
});

test("horizon: a new line goes in a month-task on Month this month, and a future item on Future or a later month", () => {
  assert.deepEqual(plain(M.horizon.slotOf("month", "2026-11", TODAY)), { date: "2026-11-30", horizon: "month-task" });
  assert.deepEqual(plain(M.horizon.slotOf("month", "2027-01", TODAY)), { date: "2027-01-31", horizon: "future" });
  assert.deepEqual(plain(M.horizon.slotOf("future", "2026-11", TODAY)), { date: "2026-12-31", horizon: "future" });
});

test("horizon: a new line on the second Future page goes under the first month of that page", () => {
  assert.deepEqual(plain(M.horizon.slotOf("future", "2026-11", TODAY, 1)), { date: "2027-02-28", horizon: "future" });
});

test("horizon: the month lists every day, empty ones too, only its own calendar entries, never a daily or month item", () => {
  const entries: Entry[] = [
    { id: "a", date: "2026-11-24", horizon: "month-calendar", position: 1 },
    { id: "b", date: "2026-11-24", horizon: "month-calendar", position: 0 },
    { id: "day", date: "2026-11-24", position: 0 },
    { id: "c", date: "2026-11-30", horizon: "month-task" },
    { id: "d", date: "2026-12-02", horizon: "month-calendar" },
  ];
  const days = plain(M.horizon.monthDays(entries, "2026-11"));
  assert.equal(days.length, 30);
  assert.deepEqual([days[0].date, days[29].date], ["2026-11-01", "2026-11-30"]);
  assert.deepEqual(days[0].entries, []);
  assert.deepEqual(days[23].entries.map((entry) => entry.id), ["b", "a"]);
  assert.deepEqual(days[29].entries, []);
});

test("horizon: a day with only daily-log entries is an empty calendar line", () => {
  const days = plain(M.horizon.monthDays([{ id: "x", date: "2026-11-10" }, { id: "y", date: "2026-11-10", horizon: "day" }], "2026-11"));
  assert.deepEqual(days[9].entries, []);
});

test("horizon: the Future Log is two pages of three months, and its pages stop at both ends", () => {
  const pages = plain(M.horizon.futurePages([], TODAY));
  assert.deepEqual(pages.map((page) => page.map((bucket) => bucket.month)), [
    ["2026-11", "2026-12", "2027-01"], ["2027-02", "2027-03", "2027-04"]
  ]);
  assert.deepEqual(plain(M.horizon.futureStep(0, 1)), { page: 1 });
  assert.equal(M.horizon.futureStep(0, -1), null);
  assert.equal(M.horizon.futureStep(1, 1), null);
});


test("horizon: six buckets, month-tasks before future items, an upcoming month with nothing stays", () => {
  const entries: Entry[] = [
    { id: "f", date: "2026-11-30", horizon: "future", position: 0 },
    { id: "m", date: "2026-11-30", horizon: "month-task", position: 1 },
    { id: "x", date: "2027-02-28", horizon: "future" },
    { id: "day", date: "2026-11-25" },
  ];
  const buckets = plain(M.horizon.buckets(entries, TODAY));
  assert.equal(buckets.length, 6);
  assert.deepEqual(buckets[0].cards.map((card) => card.entry.id), ["m", "f"]);
  assert.deepEqual(buckets[1].cards, []);
  assert.deepEqual(buckets[3].cards.map((card) => card.entry.id), ["x"]);
});

test("line: a month word files a new line under that month, and the token leaves the title", () => {
  const line = M.inline.blank({ date: "2026-11-22", horizon: "day" });
  M.inline.absorb(line, "Jahresplan @dezember", { final: true, today: TODAY });
  assert.deepEqual([line.title, line.date, line.horizon], ["Jahresplan", "2026-12-31", "future"]);
  assert.equal(M.inline.moved(line), true);
});

test("line: the current month files as a month-task, a month already past as next year's future item", () => {
  const now = M.inline.blank({ date: "2026-11-22", horizon: "day" });
  M.inline.absorb(now, "Aufräumen @nov", { final: true, today: TODAY });
  assert.deepEqual([now.date, now.horizon], ["2026-11-30", "month-task"]);
  const past = M.inline.blank({ date: "2026-11-22", horizon: "day" });
  M.inline.absorb(past, "Steuer @jan", { final: true, today: TODAY });
  assert.deepEqual([past.date, past.horizon], ["2027-01-31", "future"]);
});

test("line: a day token wins back a month line, @mo stays Monday and a bare @12 stays text", () => {
  const line = M.inline.blank({ date: "2026-12-31", horizon: "future" });
  M.inline.absorb(line, "Termin @23.11.", { final: true, today: TODAY });
  assert.deepEqual([line.date, line.horizon], ["2026-11-23", "day"]);
  const monday = M.inline.blank({ date: TODAY, horizon: "day" });
  M.inline.absorb(monday, "Team @mo", { final: true, today: TODAY });
  assert.deepEqual([monday.date, monday.horizon], ["2026-11-23", "day"]);
  const bare = M.inline.blank({ date: TODAY, horizon: "day" });
  M.inline.absorb(bare, "Raum @12", { final: true, today: TODAY });
  assert.deepEqual([bare.title, bare.date, bare.horizon], ["Raum @12", TODAY, "day"]);
});

test("line: a saved day entry that is untouched sends no horizon, a moved one sends its new group", () => {
  const entry = { id: "e", date: TODAY, type: "task", title: "Milch", position: 0, createdAt: 0, indent: 0, tags: [], time: null };
  const line = M.inline.fromEntry(entry);
  assert.deepEqual(plain(M.inline.changes(line)), {});
  line.date = "2026-12-31";
  line.horizon = "future";
  assert.deepEqual(plain(M.inline.changes(line)), { date: "2026-12-31", horizon: "future" });
});

test("line: a month line is always a task, so an event picked for it is sent as a task", () => {
  const line = M.inline.blank({ date: "2026-12-31", horizon: "future" });
  line.type = "event";
  line.title = "Konferenz";
  assert.equal(plain(M.inline.changes(line)).type, "task");
  line.horizon = "day";
  assert.equal(plain(M.inline.changes(line)).type, "event");
});

test("line: the date chip of a moved line shows dd.mm for a day and a month name for a month", () => {
  const line = M.inline.blank({ date: TODAY, horizon: "day" });
  assert.deepEqual(plain(M.days.editPills(line)), []);
  line.date = "2026-11-25";
  assert.deepEqual(plain(M.days.editPills(line)).map((pill) => pill.text), ["25.11"]);
  line.date = "2026-12-31";
  line.horizon = "future";
  assert.deepEqual(plain(M.days.editPills(line)).map((pill) => pill.text), ["December"]);
  line.date = "2027-01-31";
  assert.deepEqual(plain(M.days.editPills(line)).map((pill) => pill.text), ["January 2027"]);
});
