import assert from "node:assert/strict";
import test from "node:test";
import type { Entry } from "../src/log/types.ts";
import { buildLogDraft, checkPlaced, startReview } from "../src/log/scan/draft.ts";
import { detectKind } from "../src/log/scan/kind.ts";
import { parseHeading } from "../src/log/scan/months.ts";
import { parsePage } from "../src/log/scan/parse.ts";
import { fixedReader } from "../src/log/scan/plan.ts";
import { line } from "./fake-ocr.ts";

const NOW = "2026-11-20";

const FUTURE = [
  line("none", "Future log 2027"),
  line("none", "Januar"),
  line("•", "Steuer machen"),
  line("○", "15 Zahnarzt"),
  line("none", "Februar"),
  line("•", "Urlaub buchen"),
];
const CALENDAR = [
  line("none", "Dezember 2026"),
  line("none", "1 Di"),
  line("none", "2 Mi Lunch mit Mira"),
  line("none", "3 Do"),
  line("none", "4 Fr Konzert #musik 20h"),
  line("none", "5 Sa"),
  line("none", "7 M Team Meeting"),
];
const MONTH_TASKS = [line("none", "Dezember"), line("•", "Geschenke kaufen"), line("•", "Steuer"), line("○", "Weihnachtsfeier")];

function entry(id: string, over: Partial<Entry>): Entry {
  return { id, date: NOW, horizon: "day", type: "task", title: "x", tags: [], body: null, hasPhoto: false, time: null, indent: 0, sync: "local", syncError: null, position: 0, createdAt: 0, updatedAt: 0, onPaper: false, ...over };
}

test("month headings: German and English names, umlaut and OCR variants, a year, and what is no heading", () => {
  assert.deepEqual(parseHeading("Januar"), { type: "month", month: 1, year: null });
  assert.deepEqual(parseHeading("März"), { type: "month", month: 3, year: null });
  assert.deepEqual(parseHeading("Marz 2027"), { type: "month", month: 3, year: 2027 });
  assert.deepEqual(parseHeading("Maerz"), { type: "month", month: 3, year: null });
  assert.deepEqual(parseHeading("Dez."), { type: "month", month: 12, year: null });
  assert.deepEqual(parseHeading("December 26"), { type: "month", month: 12, year: 2026 });
  assert.deepEqual(parseHeading("11/2026"), { type: "month", month: 11, year: 2026 });
  assert.deepEqual(parseHeading("2027"), { type: "future", year: 2027 });
  assert.deepEqual(parseHeading("Future log"), { type: "future", year: null });
  assert.deepEqual(parseHeading("Zukunft 2027"), { type: "future", year: 2027 });
  assert.equal(parseHeading("Maiskolben kaufen"), null);
  assert.equal(parseHeading("Mai Bericht schreiben"), null);
  assert.equal(parseHeading("Call Mira 12"), null);
});

test("detectKind: a date header is daily, two months or a year header is future, one month is month tasks or a calendar", () => {
  assert.equal(detectKind([line("none", "20.11.2026"), line("•", "x")], null, NOW).kind, "daily");
  assert.equal(detectKind(FUTURE, null, NOW).kind, "future");
  assert.equal(detectKind([line("none", "Januar"), line("•", "a"), line("none", "Februar"), line("•", "b")], null, NOW).kind, "future");
  assert.equal(detectKind(MONTH_TASKS, null, NOW).kind, "month-task");
  assert.equal(detectKind(CALENDAR, null, NOW).kind, "calendar");
  assert.deepEqual(detectKind([line("•", "Brot")], null, NOW), { kind: "daily", source: "default" });
});

test("detectKind: the view is a weak prior, a strong page signal beats it, and a valid LLM kind beats both", () => {
  const plain = [line("•", "Brot"), line("•", "Milch")];
  assert.deepEqual(detectKind(plain, "future", NOW), { kind: "future", source: "view" });
  assert.deepEqual(detectKind(plain, "month", NOW), { kind: "month-task", source: "view" });
  assert.deepEqual(detectKind(plain, "daily", NOW), { kind: "daily", source: "view" });
  assert.equal(detectKind([line("none", "20.11.2026"), line("•", "x")], "future", NOW).kind, "daily");
  assert.equal(detectKind(FUTURE, "month", NOW).kind, "future");
  assert.deepEqual(detectKind(plain, "month", NOW, "calendar"), { kind: "calendar", source: "llm" });
  assert.equal(detectKind(plain, "month", NOW, "nonsense").kind, "month-task", "an LLM kind that is no kind is ignored");
});

test("detectKind: a day number is never a daily header, and a task list with numbers is no calendar", () => {
  assert.equal(detectKind([line("none", "15"), line("•", "Zahnarzt")], null, NOW).kind, "daily");
  const numbered = [line("none", "Dezember"), line("•", "2 Eier kaufen"), line("•", "3 Kisten"), line("•", "4 Karten")];
  assert.equal(detectKind(numbered, null, NOW).kind, "month-task");
});

test("future page: lines go under their month heading, the year comes from the header, and an event becomes a task", () => {
  const page = parsePage(FUTURE, NOW, "future");
  assert.equal(page.kind, "future");
  assert.deepEqual(page.lines.map((l) => [l.id, l.type, l.title, l.month]), [
    ["l3", "task", "Steuer machen", "2027-01"],
    ["l4", "task", "15 Zahnarzt", "2027-01"],
    ["l6", "task", "Urlaub buchen", "2027-02"],
  ]);
});

test("future page: a leading day number stays in the title, it is not filed as a day", () => {
  const [item] = parsePage([line("none", "Januar"), line("•", "15 Zahnarzt")], NOW, "future").lines;
  assert.equal(item.title, "15 Zahnarzt");
  assert.equal(item.day, undefined);
});

test("future page: with no year written the year follows the fallback, rolling over December to January and back from a far month", () => {
  const months = (lines: ReturnType<typeof line>[], fallback: string) => parsePage(lines, fallback, "future").lines.map((l) => l.month);
  const page = [line("none", "November"), line("•", "a"), line("none", "Dezember"), line("•", "b"), line("none", "Januar"), line("•", "c")];
  assert.deepEqual(months(page, NOW), ["2026-11", "2026-12", "2027-01"]);
  assert.deepEqual(months([line("none", "Januar"), line("•", "a")], "2026-12-05"), ["2027-01"]);
  assert.deepEqual(months([line("none", "Januar"), line("•", "a")], "2026-11-20"), ["2027-01"], "Jan is 10 months behind: next year");
  assert.deepEqual(months([line("none", "Oktober"), line("•", "a")], NOW), ["2026-10"], "a month 1 behind stays this year");
  assert.deepEqual(months([line("none", "Januar 2028"), line("•", "a")], NOW), ["2028-01"]);
});

test("future page: a line above the first heading goes in the first month, and the LLM period gives the year", () => {
  const lines = [line("•", "oben"), line("none", "Mai"), line("•", "unten")];
  assert.deepEqual(parsePage(lines, NOW, "future", "2028").lines.map((l) => l.month), ["2028-05", "2028-05"]);
});

test("month-task page: one list in the month of the heading, no day, an event becomes a task", () => {
  const page = parsePage(MONTH_TASKS, NOW, "month-task");
  assert.equal(page.month, "2026-12");
  assert.deepEqual(page.lines.map((l) => [l.id, l.type, l.title, l.day, l.month]), [
    ["l2", "task", "Geschenke kaufen", undefined, undefined],
    ["l3", "task", "Steuer", undefined, undefined],
    ["l4", "task", "Weihnachtsfeier", undefined, undefined],
  ]);
  assert.equal(parsePage(MONTH_TASKS, "2027-02-01", "month-task").month, "2026-12", "the nearest year to the fallback");
  assert.equal(parsePage([line("none", "Februar"), line("•", "x")], "2026-12-01", "month-task").month, "2027-02");
});

test("calendar page: day rows give their day, weekday letters go, empty days are dropped, and a no-bullet row is an event", () => {
  const page = parsePage(CALENDAR, NOW, "calendar");
  assert.equal(page.month, "2026-12");
  assert.deepEqual(page.lines.map((l) => [l.id, l.type, l.title, l.day, l.tags, l.time]), [
    ["l3", "event", "Lunch mit Mira", 2, [], null],
    ["l5", "event", "Konzert", 4, ["musik"], "20:00"],
    ["l7", "event", "Team Meeting", 7, [], null],
  ]);
});

test("calendar page: a bulleted line under a day row stays on that day, and a weekday column of capitals is stripped", () => {
  const lines = [line("none", "Dezember"), line("none", "12 S"), line("•", "Karten holen"), line("none", "13 S Brunch")];
  const page = parsePage(lines, NOW, "calendar");
  assert.deepEqual(page.lines.map((l) => [l.type, l.title, l.day]), [["task", "Karten holen", 12], ["event", "Brunch", 13]]);
});

test("daily page: nothing changes for a daily page, a month name in a title is no heading", () => {
  const page = parsePage([line("none", "20.11.2026"), line("•", "Mai Bericht"), line("none", "Dezember")], NOW);
  assert.equal(page.kind, "daily");
  assert.equal(page.month, null);
  assert.deepEqual(page.lines.map((l) => l.title), ["Mai Bericht", "Dezember"]);
});

test("startReview: reads the page for the detected kind, groups lines in their slots and matches each slot's entries", () => {
  const ocr = { lines: MONTH_TASKS, width: 1, height: 1, ms: 1 };
  const draft = buildLogDraft({ ocr, fallbackDate: NOW, now: 0, ttlMs: 10 });
  assert.equal(draft.detected.kind, "month-task");
  const reader = fixedReader([
    entry("m1", { horizon: "month-task", date: "2026-12-31", title: "Geschenke kaufen" }),
    entry("d1", { horizon: "day", date: "2026-12-31", title: "Steuer" }),
  ]);
  const review = startReview(draft, reader);
  assert.deepEqual([review.kind, review.month, review.detected.source], ["month-task", "2026-12", "page"]);
  assert.deepEqual(review.items.map((i) => [i.title, i.status]), [["Geschenke kaufen", "unchanged"], ["Steuer", "new"], ["Weihnachtsfeier", "new"]], "a day entry of the last day is not a month entry");
  const daily = startReview(draft, reader, "daily");
  assert.equal(daily.kind, "daily");
  assert.equal(daily.items.length, 4, "the month heading is an ordinary line on a daily page");
});

test("startReview: a future page matches per month, a calendar page per day, and a rescan agrees with what was filed", () => {
  const future = buildLogDraft({ ocr: { lines: FUTURE, width: 1, height: 1, ms: 1 }, fallbackDate: NOW, now: 0, ttlMs: 10 });
  const futureReader = fixedReader([
    entry("f1", { horizon: "future", date: "2027-01-31", title: "Steuer machen" }),
    entry("f2", { horizon: "future", date: "2027-01-31", title: "15 Zahnarzt" }),
    entry("f3", { horizon: "future", date: "2027-01-31", title: "Urlaub buchen" }),
  ]);
  assert.deepEqual(startReview(future, futureReader).items.map((i) => [i.title, i.status]), [["Steuer machen", "unchanged"], ["15 Zahnarzt", "unchanged"], ["Urlaub buchen", "new"]], "Urlaub is in Februar, not Januar");

  const calendar = buildLogDraft({ ocr: { lines: CALENDAR, width: 1, height: 1, ms: 1 }, fallbackDate: NOW, now: 0, ttlMs: 10 });
  const calendarReader = fixedReader([entry("c1", { horizon: "month-calendar", date: "2026-12-02", type: "event", title: "Lunch mit Mira" })]);
  assert.deepEqual(startReview(calendar, calendarReader).items.map((i) => [i.day, i.status]), [[2, "unchanged"], [4, "new"], [7, "new"]]);
  const dailyReader = fixedReader([entry("d1", { date: "2026-12-02", type: "event", title: "Lunch mit Mira" })]);
  assert.deepEqual(startReview(calendar, dailyReader).items.map((i) => [i.day, i.status]), [[2, "new"], [4, "new"], [7, "new"]], "a daily-log entry is not the calendar entry");
});

test("startReview: a > line that a trace on the same page answers is unchanged with no target, a plain new > line is not", () => {
  const draft = buildLogDraft({ ocr: { lines: [line("none", "20.11.2026"), line(">", "Umzug planen"), line(">", "Etwas anderes"), line("<", "Umzug planen")], width: 1, height: 1, ms: 1 }, fallbackDate: NOW, now: 0, ttlMs: 10 });
  const trace = { id: "t1", entryId: "e9", date: NOW, horizon: "day" as const, kind: "migrated" as const, title: "Umzug planen", createdAt: 1 };
  const review = startReview(draft, fixedReader([], [trace]));
  assert.deepEqual(review.items.map((i) => [i.title, i.status, i.traced, i.target, i.include]), [
    ["Umzug planen", "unchanged", true, null, false],
    ["Etwas anderes", "new", undefined, null, true],
    ["Umzug planen", "new", undefined, null, true],
  ]);
});

test("trace: OCR noise still matches the trace, and an un-matched line does not", () => {
  const draft = buildLogDraft({ ocr: { lines: [line("none", "20.11.2026"), line(">", "Umzug plamen"), line("<", "Zahnarzt anrufen")], width: 1, height: 1, ms: 1 }, fallbackDate: NOW, now: 0, ttlMs: 10 });
  const traces = [
    { id: "t1", entryId: "e9", date: NOW, horizon: "day" as const, kind: "migrated" as const, title: "Umzug planen", createdAt: 1 },
    { id: "t2", entryId: "e8", date: NOW, horizon: "day" as const, kind: "scheduled" as const, title: "Zahnarzt anrufen", createdAt: 1 },
  ];
  const review = startReview(draft, fixedReader([], traces));
  assert.deepEqual(review.items.map((i) => [i.status, i.traced]), [["unchanged", true], ["unchanged", true]]);
  const asked = review.items.map((i, index) => ({ line: { id: i.id, type: i.type, title: i.title, unmatched: index === 0 }, slot: { horizon: "day" as const, date: NOW } }));
  const checks = checkPlaced(asked, fixedReader([], traces));
  assert.deepEqual(checks.map((c) => [c.status, c.traced]), [["new", undefined], ["unchanged", true]]);
});
