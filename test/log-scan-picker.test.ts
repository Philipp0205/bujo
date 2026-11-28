import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

type Option = { value: string | number; label: string; selected: boolean };
type Step = { step: string; value: string | number | null; label: string };
type Item = { month: string | null };
type State = { kind: string; detectedKind: string; page: number; pages: number[]; month: string; rangeFrom: string | null; items: Item[] };
type Page = { type: "log" | "note"; noteKind: string | null; state: State };
type Model = {
  typeOf(page: Page): string;
  subOf(page: Page): string;
  kindOfSub(sub: string, state: State): string;
  kindOfPart(part: string): string;
  steps(page: Page): Step[];
  linkOf(page: Page): string;
  options(step: string, page: Page): Option[];
  setTarget(state: State, value: string | number): void;
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** The real copy, scan model, pages model and picker model in a page-like sandbox, with a fixed today (2026-11-28). */
function load(): Model {
  const L: Record<string, unknown> = {
    copy: { pages: { picker: { months: MONTHS } } },
    dates: { todayIso: () => "2026-11-28" },
  };
  const context = vm.createContext({ window: { BujoLog: L }, String, Math, Number, Array, Object, RegExp, Date, Blob: class {} });
  for (const file of ["scan/copy.js", "pages/model.js", "scan/model.js", "scan/picker/model.js"]) {
    vm.runInContext(readFileSync(new URL(`../public/js/log/${file}`, import.meta.url), "utf8"), context);
  }
  return (L.scan as { picker: { model: Model } }).picker.model;
}

const model = load();
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const state = (extra: Partial<State> = {}): State => ({ kind: "daily", detectedKind: "daily", page: 1, pages: [], month: "2026-11", rangeFrom: null, items: [], ...extra });
const logPage = (extra: Partial<State> = {}): Page => ({ type: "log", noteKind: null, state: state(extra) });
const labels = (list: Array<{ label: string }>) => Array.from(list, (entry) => entry.label);

test("a daily log page reads Log, Daily, Page n", () => {
  assert.deepEqual(labels(model.steps(logPage({ page: 2 }))), ["Log", "Daily", "Page 2"]);
  assert.equal(model.linkOf(logPage()), "arrow");
});

test("both monthly kinds read as Monthly with the month and the page of the month, and the month shows the year only when it is not this year", () => {
  assert.deepEqual(labels(model.steps(logPage({ kind: "calendar" }))), ["Log", "Monthly", "November", "calendar"]);
  assert.deepEqual(labels(model.steps(logPage({ kind: "month-task", month: "2027-01" }))), ["Log", "Monthly", "January 2027", "tasks"]);
});

test("the page of the month offers calendar and tasks, and each files as its own kind", () => {
  assert.deepEqual(labels(model.options("part", logPage({ kind: "month-task" }))), ["calendar", "tasks"]);
  assert.deepEqual(plain(model.options("part", logPage({ kind: "month-task" }))).map((option) => option.selected), [false, true]);
  assert.equal(model.kindOfPart("calendar"), "calendar");
  assert.equal(model.kindOfPart("tasks"), "month-task");
  assert.equal(model.steps(logPage()).length, 3);
});

test("a future page reads its range from the months of its lines, or from the range that was picked", () => {
  const lines = [{ month: "2027-01" }, { month: null }, { month: "2027-03" }];
  assert.deepEqual(labels(model.steps(logPage({ kind: "future", items: lines }))), ["Log", "Future", "Jan - Mar"]);
  assert.deepEqual(labels(model.steps(logPage({ kind: "future", items: lines, rangeFrom: "2026-10" }))), ["Log", "Future", "Oct - Dec"]);
  assert.equal(labels(model.steps(logPage({ kind: "future", items: [{ month: "2027-02" }] })))[2], "Feb");
  assert.equal(labels(model.steps(logPage({ kind: "future" })))[2], "Oct - Dec");
});

test("a collection has two steps joined by a branch, and is misc until a kind is picked", () => {
  const page: Page = { type: "note", noteKind: null, state: state() };
  assert.deepEqual(labels(model.steps(page)), ["Collection", "misc"]);
  assert.equal(model.linkOf(page), "branch");
  assert.equal(model.typeOf(page), "collection");
  assert.equal(model.subOf({ ...page, noteKind: "tracker" }), "tracker");
  assert.deepEqual(labels(model.options("sub", page)), ["list", "tracker", "project", "misc"]);
  assert.deepEqual(plain(model.options("sub", page)).map((option) => option.selected), [false, false, false, true]);
});

test("the first step offers Log and Collection, the second the log kinds", () => {
  assert.deepEqual(labels(model.options("type", logPage())), ["Log", "Collection"]);
  assert.deepEqual(labels(model.options("sub", logPage())), ["Daily", "Monthly", "Future"]);
  assert.deepEqual(plain(model.options("sub", logPage({ kind: "future" }))).map((option) => option.selected), [false, false, true]);
});

test("Monthly keeps a monthly kind, else takes the detected one, else the calendar", () => {
  assert.equal(model.kindOfSub("monthly", state({ kind: "month-task" })), "month-task");
  assert.equal(model.kindOfSub("monthly", state({ kind: "daily", detectedKind: "month-task" })), "month-task");
  assert.equal(model.kindOfSub("monthly", state()), "calendar");
  assert.equal(model.kindOfSub("daily", state({ kind: "future" })), "daily");
  assert.equal(model.kindOfSub("future", state()), "future");
});

test("the target choices are the pages of the day, the months around now, or the next four quarters", () => {
  assert.deepEqual(labels(model.options("target", logPage({ page: 2, pages: [1, 2] }))), ["Page 1", "Page 2", "Page 3"]);
  const months = labels(model.options("target", logPage({ kind: "calendar" })));
  assert.equal(months.length, 14);
  assert.deepEqual([months[0], months[1]], ["October", "November"]);
  assert.equal(months[months.length - 1], "November 2027");
  assert.deepEqual(labels(model.options("target", logPage({ kind: "future" }))), ["Oct - Dec", "Jan - Mar", "Apr - Jun", "Jul - Sep"]);
});

test("a month outside the offered ones is still a choice, and the current month is the selected one", () => {
  const months = model.options("target", logPage({ kind: "month-task", month: "2029-05" }));
  assert.equal(months[months.length - 1].label, "May 2029");
  assert.deepEqual(plain(months.filter((option) => option.selected).map((option) => option.value)), ["2029-05"]);
});

test("picking a target sets the page, the month or the range, and the range files lines with no month on its first month", () => {
  const daily = state();
  model.setTarget(daily, 3);
  assert.equal(daily.page, 3);

  const monthly = state({ kind: "calendar", items: [{ month: null }] });
  model.setTarget(monthly, "2027-02");
  assert.equal(monthly.month, "2027-02");

  const future = state({ kind: "future", items: [{ month: null }, { month: "2027-05" }] });
  model.setTarget(future, "2027-01");
  assert.equal(future.rangeFrom, "2027-01");
  assert.deepEqual(plain(future.items), [{ month: "2027-01" }, { month: "2027-05" }]);
});
