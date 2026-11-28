import { expect, test, type Page } from "@playwright/test";
import { useBujo, WHATS_NEW_NEWEST } from "./harness.ts";

const app = useBujo();

test.beforeEach(async ({ page }) => {
  await app.signIn(page);
  // The install banner and the what's new sheet would sit over the log, so both are out of the way before any page script runs.
  await page.addInitScript(() => sessionStorage.setItem("ak-install-prompt-dismissed", "1"));
  await page.request.put(`${app.baseUrl}/api/whats-new/seen`, { data: { id: WHATS_NEW_NEWEST } });
});

const pad = (n: number) => String(n).padStart(2, "0");

/** A calendar day as YYYY-MM-DD in the local time zone, n days from today (the page uses the local day too). */
function day(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The month n months from this one, as YYYY-MM. */
function month(ahead: number): string {
  const date = new Date(new Date().getFullYear(), new Date().getMonth() + ahead, 1);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

/** The last day of the month n months from this one: the date a month-task or future item carries. */
function lastDay(ahead: number): string {
  const date = new Date(new Date().getFullYear(), new Date().getMonth() + ahead + 1, 0);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Every test starts from an empty log: all entries of the throwaway account go (their traces go with them). */
test.afterEach(async ({ page }) => {
  const response = await page.request.get(`${app.baseUrl}/api/entries?from=${month(0)}-01&to=${lastDay(5)}`);
  for (const entry of (await response.json()).entries as Array<{ id: string }>) await page.request.delete(`${app.baseUrl}/api/entries/${entry.id}`);
  const near = await page.request.get(`${app.baseUrl}/api/entries?from=${day(-6)}&to=${day(7)}`);
  for (const entry of (await near.json()).entries as Array<{ id: string }>) await page.request.delete(`${app.baseUrl}/api/entries/${entry.id}`);
});

type Entry = { id: string; date: string; horizon: string; type: string; title: string; onPaper: boolean };
type Trace = { entryId: string; date: string; horizon: string; kind: string; title: string };

/** One fake entry through the API with the page's session. Never a real list. Resolves with its id. */
async function seed(page: Page, data: { date: string; title: string; horizon?: string; type?: string }): Promise<string> {
  const response = await page.request.post(`${app.baseUrl}/api/entries`, { data: { type: "task", ...data } });
  expect(response.status()).toBe(201);
  return (await response.json()).entry.id as string;
}

/** What the API holds from the first of this month through the sixth month: the entries and the traces. */
async function stored(page: Page): Promise<{ entries: Entry[]; traces: Trace[] }> {
  const response = await page.request.get(`${app.baseUrl}/api/entries?from=${month(0)}-01&to=${lastDay(5)}&traces=1`);
  return response.json();
}

/** The entry of a title, as the API holds it now. */
async function entryOf(page: Page, text: string): Promise<Entry> {
  return (await stored(page)).entries.find((entry) => entry.title === text)!;
}

const switcher = (page: Page) => page.getByTestId("view-switcher");
const tab = (page: Page, name: "future" | "month" | "daily") => page.getByTestId(`view-${name}`);
const live = (page: Page, text: string) => page.locator(".paper-row:not(.paper-trace)", { hasText: text });
const traceRows = (page: Page) => page.getByTestId("trace-row");
const marker = (page: Page) => page.getByTestId("type-marker");
const chooser = (page: Page) => page.getByTestId("type-chooser");
const move = (page: Page) => page.getByTestId("move-chooser");
const title = (page: Page) => page.getByRole("textbox", { name: "Entry title" });
const dest = (page: Page, key: string) => move(page).locator(`[data-dest="${key}"]`);

/** Opens the log (or a link into it) and waits until its scripts are wired, so a tap is heard. */
async function openLog(page: Page, query = ""): Promise<void> {
  await page.goto(`${app.baseUrl}/${query}`);
  await expect(switcher(page)).toBeVisible();
  await page.waitForFunction(() => !!document.querySelector(".paper-add, .month-calendar"));
}

/** Turns from the open month's calendar page to its tasks page. */
async function toTasks(page: Page): Promise<void> {
  await page.getByTestId("month-next").click();
  await expect(page.getByTestId("month-tasks")).toBeVisible();
}

/** Taps the row of an entry, then the marker and a type in the type chooser: the move chooser is open after it. */
async function chooseMove(page: Page, text: string, type: "migrated" | "scheduled"): Promise<void> {
  await live(page, text).click();
  await expect(title(page)).toBeFocused();
  await marker(page).click();
  await chooser(page).locator(`.type-option[data-type="${type}"]`).click();
  await expect(move(page)).toBeVisible();
  await expect(title(page)).toBeFocused();
}

test("Moved on a saved entry opens a chooser with next day, a day of your choice, this month and the later months", async ({ page }) => {
  await seed(page, { date: day(0), title: "Chooser Probe" });
  await openLog(page);
  await chooseMove(page, "Chooser Probe", "migrated");

  await expect(move(page)).toHaveAttribute("data-kind", "migrate");
  await expect(chooser(page)).toHaveCount(0);
  await expect(dest(page, `day:${day(1)}`)).toHaveText("Next day");
  await expect(move(page).getByTestId("move-date")).toBeVisible();
  await expect(dest(page, `month:${month(0)}`)).toHaveText("This month");
  await expect(move(page).locator(".move-chip")).toHaveCount(5);
  await expect(dest(page, "here")).toHaveCount(0);

  // Escape closes the chooser first and leaves the sheet and the entry as they were.
  await page.keyboard.press("Escape");
  await expect(move(page)).toHaveCount(0);
  await expect(page.getByTestId("edit-sheet")).toBeVisible();
  expect(await entryOf(page, "Chooser Probe")).toMatchObject({ date: day(0), horizon: "day", type: "task" });
  expect((await stored(page)).traces).toHaveLength(0);
});

test("Scheduled offers This day beside the others, but no Today", async ({ page }) => {
  await seed(page, { date: day(-1), title: "Schedule Probe" });
  await openLog(page, `?day=${day(-1)}`);
  await chooseMove(page, "Schedule Probe", "scheduled");

  await expect(move(page)).toHaveAttribute("data-kind", "schedule");
  await expect(dest(page, "here")).toHaveText("This day");
  await expect(move(page).getByRole("button", { name: "Today", exact: true })).toHaveCount(0);
  await expect(move(page).getByRole("button", { name: "Next day", exact: true })).toBeVisible();
});

test("migrate day to day: the entry keeps its id on the next day, and a > trace stays on the old page", async ({ page }) => {
  const id = await seed(page, { date: day(0), title: "Weiter auf morgen" });
  await openLog(page);
  await chooseMove(page, "Weiter auf morgen", "migrated");
  await dest(page, `day:${day(1)}`).click();

  await expect(page.getByTestId("edit-sheet")).toBeHidden();
  await expect(live(page, "Weiter auf morgen")).toHaveCount(0);
  await expect(traceRows(page)).toHaveCount(1);
  await expect(traceRows(page).first()).toHaveText("Weiter auf morgen");
  await expect(traceRows(page).first()).toHaveAttribute("data-trace", "migrated");
  await expect(traceRows(page).first().locator("svg")).toHaveAttribute("data-glyph", "migrated");

  const now = await stored(page);
  expect(now.entries.map((entry) => entry.id)).toEqual([id]);
  expect(now.entries[0]).toMatchObject({ date: day(1), horizon: "day", type: "task", onPaper: false });
  expect(now.traces).toMatchObject([{ entryId: id, date: day(0), horizon: "day", kind: "migrated", title: "Weiter auf morgen" }]);

  await page.reload();
  await expect(traceRows(page)).toHaveCount(1);
  await expect(live(page, "Weiter auf morgen")).toHaveCount(0);
});

test("a trace is no entry: no toggle, no tap target, and a tap on it opens nothing", async ({ page }) => {
  await seed(page, { date: day(0), title: "Nur eine Spur" });
  await openLog(page);
  await chooseMove(page, "Nur eine Spur", "migrated");
  await dest(page, `day:${day(1)}`).click();
  await expect(traceRows(page)).toHaveCount(1);

  await expect(traceRows(page).getByTestId("toggle-done")).toHaveCount(0);
  await expect(traceRows(page).locator("button")).toHaveCount(0);
  await traceRows(page).first().click();
  await expect(page.getByTestId("edit-sheet")).toBeHidden();
  const opacity = await traceRows(page).first().evaluate((node) => getComputedStyle(node).opacity);
  expect(Number(opacity)).toBeLessThan(1);
});

test("migrate day to this month: a month task in the Month view, with the trace on the day", async ({ page }) => {
  const id = await seed(page, { date: day(0), title: "In den Monat" });
  await openLog(page);
  await chooseMove(page, "In den Monat", "migrated");
  await dest(page, `month:${month(0)}`).click();
  await expect(traceRows(page)).toHaveCount(1);

  expect(await entryOf(page, "In den Monat")).toMatchObject({ id, date: lastDay(0), horizon: "month-task", type: "task" });
  await tab(page, "month").click();
  await toTasks(page);
  await expect(page.getByTestId("month-tasks").locator(".paper-row:not(.paper-trace)", { hasText: "In den Monat" })).toHaveCount(1);
  await expect(page.getByTestId("month-tasks").locator(".paper-row:not(.paper-trace)", { hasText: "In den Monat" })).toHaveAttribute("data-horizon", "month-task");
});

test("migrate day to a future month: the Future view lists it under that month", async ({ page }) => {
  const id = await seed(page, { date: day(0), title: "Weit voraus" });
  await openLog(page);
  await chooseMove(page, "Weit voraus", "migrated");
  await dest(page, `month:${month(2)}`).click();
  await expect(traceRows(page)).toHaveCount(1);

  expect(await entryOf(page, "Weit voraus")).toMatchObject({ id, date: lastDay(2), horizon: "future", type: "task" });
  await tab(page, "future").click();
  const bucket = page.getByTestId("future-bucket").nth(2);
  await expect(bucket.locator(".paper-row:not(.paper-trace)", { hasText: "Weit voraus" })).toHaveCount(1);
  await expect(page.getByTestId("future-bucket").nth(0).getByTestId("trace-row")).toHaveCount(0);
});

test("migrate month to month: the item moves to the chosen month and the old month keeps a trace", async ({ page }) => {
  const id = await seed(page, { date: lastDay(0), title: "Monatsumzug", horizon: "month-task" });
  await openLog(page, "?view=month");
  await toTasks(page);
  await expect(live(page, "Monatsumzug")).toBeVisible();
  await chooseMove(page, "Monatsumzug", "migrated");
  await expect(dest(page, `month:${month(0)}`)).toHaveCount(0);
  await dest(page, `month:${month(3)}`).click();

  const tasks = page.getByTestId("month-tasks");
  await expect(tasks.getByTestId("trace-row")).toHaveCount(1);
  await expect(tasks.locator(".paper-row:not(.paper-trace)", { hasText: "Monatsumzug" })).toHaveCount(0);
  const now = await stored(page);
  expect(now.entries.find((entry) => entry.id === id)).toMatchObject({ date: lastDay(3), horizon: "future" });
  expect(now.traces).toMatchObject([{ entryId: id, date: lastDay(0), horizon: "month-task", kind: "migrated" }]);

  await tab(page, "future").click();
  await page.getByTestId("future-next").click();
  await expect(page.getByTestId("future-bucket").nth(0).locator(".paper-row:not(.paper-trace)", { hasText: "Monatsumzug" })).toHaveCount(1);
});

test("migrate month to a chosen day: the item becomes a day task on the day you pick", async ({ page }) => {
  const id = await seed(page, { date: lastDay(0), title: "Auf einen Tag", horizon: "month-task" });
  await openLog(page, "?view=month");
  await toTasks(page);
  await chooseMove(page, "Auf einen Tag", "migrated");
  await move(page).getByTestId("move-date").fill(day(2));

  await expect(page.getByTestId("edit-sheet")).toBeHidden();
  const now = await stored(page);
  expect(now.entries.find((entry) => entry.id === id)).toMatchObject({ date: day(2), horizon: "day", type: "task" });
  expect(now.traces).toMatchObject([{ entryId: id, date: lastDay(0), horizon: "month-task", kind: "migrated" }]);
  await tab(page, "daily").click();
  await page.goto(`${app.baseUrl}/?day=${day(2)}`);
  await expect(live(page, "Auf einen Tag")).toHaveCount(1);
});

test("schedule onto a day: a scheduled entry on that day and a < trace on the old one", async ({ page }) => {
  const id = await seed(page, { date: day(0), title: "Termin setzen" });
  await openLog(page);
  await chooseMove(page, "Termin setzen", "scheduled");
  await move(page).getByTestId("move-date").fill(day(3));

  await expect(traceRows(page)).toHaveCount(1);
  await expect(traceRows(page).first()).toHaveAttribute("data-trace", "scheduled");
  await expect(traceRows(page).first().locator("svg")).toHaveAttribute("data-glyph", "scheduled");
  const now = await stored(page);
  expect(now.entries.find((entry) => entry.id === id)).toMatchObject({ date: day(3), horizon: "day", type: "scheduled" });
  expect(now.traces).toMatchObject([{ entryId: id, date: day(0), kind: "scheduled" }]);
});

test("schedule into a future month: it stays a task there, and the trace on the day is a <", async ({ page }) => {
  const id = await seed(page, { date: day(0), title: "Später planen" });
  await openLog(page);
  await chooseMove(page, "Später planen", "scheduled");
  await dest(page, `month:${month(4)}`).click();

  await expect(traceRows(page)).toHaveCount(1);
  const now = await stored(page);
  expect(now.entries.find((entry) => entry.id === id)).toMatchObject({ date: lastDay(4), horizon: "future", type: "task" });
  expect(now.traces).toMatchObject([{ entryId: id, date: day(0), horizon: "day", kind: "scheduled" }]);
  await tab(page, "future").click();
  await page.getByTestId("future-next").click();
  await expect(page.getByTestId("future-bucket").nth(1).locator(".paper-row:not(.paper-trace)", { hasText: "Später planen" })).toHaveCount(1);
});

test("a written @month in the title preselects its month in the chooser, and nothing is filed twice", async ({ page }) => {
  await seed(page, { date: day(0), title: "Token Probe" });
  await openLog(page);
  await live(page, "Token Probe").click();
  await expect(title(page)).toBeFocused();
  await page.keyboard.type(` @${month(2).slice(5, 7)}.${month(2).slice(0, 4)}`);
  await marker(page).click();
  await chooser(page).locator('.type-option[data-type="migrated"]').click();

  await expect(dest(page, `month:${month(2)}`)).toHaveAttribute("aria-pressed", "true");
  await expect(title(page)).toHaveValue("Token Probe");
  await dest(page, `month:${month(2)}`).click();
  await expect(traceRows(page)).toHaveCount(1);
  const now = await stored(page);
  expect(now.entries).toHaveLength(1);
  expect(now.entries[0]).toMatchObject({ title: "Token Probe", date: lastDay(2), horizon: "future" });
  expect(now.traces).toHaveLength(1);
});

test("offline, a move is queued with its trace shown, and the server holds both once the device is back", async ({ page }) => {
  const id = await seed(page, { date: day(0), title: "Offline weiter" });
  await openLog(page);
  await page.context().setOffline(true);
  await chooseMove(page, "Offline weiter", "migrated");
  await dest(page, `day:${day(1)}`).click();

  await expect(page.getByTestId("edit-sheet")).toBeHidden();
  await expect(traceRows(page)).toHaveCount(1);
  await expect(live(page, "Offline weiter")).toHaveCount(0);

  await page.context().setOffline(false);
  await expect.poll(async () => (await stored(page)).traces.length).toBe(1);
  const now = await stored(page);
  expect(now.entries.find((entry) => entry.id === id)).toMatchObject({ date: day(1), horizon: "day" });
  expect(now.traces[0]).toMatchObject({ entryId: id, date: day(0), kind: "migrated" });
  await expect(traceRows(page)).toHaveCount(1);
});

test("an entry moved with > to a day beyond the loaded days is on that day's log, and the old page keeps its trace", async ({ page }) => {
  const id = await seed(page, { date: day(0), title: "Weit weg" });
  await openLog(page);
  await chooseMove(page, "Weit weg", "migrated");
  await move(page).getByTestId("move-date").fill(day(12));
  await expect(page.getByTestId("edit-sheet")).toBeHidden();
  await expect(traceRows(page)).toHaveCount(1);
  await expect(traceRows(page).first()).toHaveText("Weit weg");

  // Straight after the move, and again after another tab and back (which reads the log again), the next arrow reaches the new day.
  await expect(page.getByTestId("page-next")).toBeEnabled();
  await page.getByRole("navigation", { name: "Main" }).getByText("Notes").click();
  await page.getByRole("navigation", { name: "Main" }).getByText("Daily log").click();
  await expect(switcher(page)).toBeVisible();
  await expect(page.getByTestId("page-next")).toBeEnabled();
  await page.getByTestId("page-next").click();
  await expect(page.getByTestId("page-body")).toHaveAttribute("data-date", day(12));
  await expect(live(page, "Weit weg")).toHaveCount(1);

  // After a reload the day picker reaches it too: its day carries a mark and opens the page.
  await page.goto(app.baseUrl);
  await expect(switcher(page)).toBeVisible();
  await page.getByTestId("page-date").click();
  if (day(12).slice(0, 7) !== day(0).slice(0, 7)) await page.getByTestId("picker-next").click();
  await page.locator(`[data-testid="picker-day"][data-date="${day(12)}"]`).click();
  await expect(page.getByTestId("page-body")).toHaveAttribute("data-date", day(12));
  await expect(live(page, "Weit weg")).toHaveCount(1);
  await page.goto(app.baseUrl);
  await expect(traceRows(page)).toHaveCount(1);
  expect(await entryOf(page, "Weit weg")).toMatchObject({ id, date: day(12), horizon: "day" });
});

test("Moved offers Today when the entry is on another day, and a pick lands it on today with a trace behind", async ({ page }) => {
  const id = await seed(page, { date: day(-2), title: "Heute nachholen" });
  await openLog(page, `?day=${day(-2)}`);
  await chooseMove(page, "Heute nachholen", "migrated");

  await expect(move(page).getByRole("button", { name: "Today", exact: true })).toHaveAttribute("data-dest", `day:${day(0)}`);
  await expect(move(page).getByRole("button", { name: "Today", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(dest(page, "here")).toHaveCount(0);
  await expect(move(page).getByRole("button", { name: "Next day", exact: true })).toBeVisible();
  await expect(move(page).getByTestId("move-date")).toBeVisible();
  await expect(dest(page, `month:${month(0)}`)).toHaveText("This month");

  await move(page).getByRole("button", { name: "Today", exact: true }).click();
  await expect(page.getByTestId("edit-sheet")).toBeHidden();
  await expect(traceRows(page)).toHaveCount(1);
  const now = await stored(page);
  expect(now.entries[0]).toMatchObject({ id, date: day(0), horizon: "day", type: "task" });
  expect(now.traces).toMatchObject([{ entryId: id, date: day(-2), horizon: "day", kind: "migrated" }]);
  await page.goto(app.baseUrl);
  await expect(live(page, "Heute nachholen")).toHaveCount(1);
});

test("Today is not offered on today's page", async ({ page }) => {
  await seed(page, { date: day(0), title: "Schon heute" });
  await openLog(page);
  await chooseMove(page, "Schon heute", "migrated");
  await expect(dest(page, `day:${day(0)}`)).toHaveCount(0);
  await expect(move(page).getByRole("button", { name: "Today", exact: true })).toHaveCount(0);
  await expect(dest(page, `day:${day(1)}`)).toHaveText("Next day");
});

test("moving back to the old day takes its trace away", async ({ page }) => {
  await seed(page, { date: day(0), title: "Hin und zurück" });
  await openLog(page);
  await chooseMove(page, "Hin und zurück", "migrated");
  await dest(page, `day:${day(1)}`).click();
  await expect(traceRows(page)).toHaveCount(1);

  await page.goto(`${app.baseUrl}/?day=${day(1)}`);
  await live(page, "Hin und zurück").click();
  await marker(page).click();
  await chooser(page).locator('.type-option[data-type="migrated"]').click();
  await move(page).getByTestId("move-date").fill(day(0));
  await expect(page.getByTestId("edit-sheet")).toBeHidden();

  await expect.poll(async () => (await stored(page)).traces.map((trace) => trace.date)).toContain(day(1));
  const now = await stored(page);
  expect(now.entries[0]).toMatchObject({ date: day(0) });
  expect(now.traces.some((trace) => trace.date === day(0))).toBe(false);
});
