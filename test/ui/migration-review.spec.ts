import { expect, test, type Page } from "@playwright/test";
import { pinClock, pinnedDay, pinnedLastDay, pinnedMonth, useBujo, WHATS_NEW_NEWEST } from "./harness.ts";

const app = useBujo();

test.beforeEach(async ({ page }) => {
  await pinClock(page);
  await app.signIn(page);
  // The install banner and the what's new sheet would sit over the log, so both are out of the way before any page script runs.
  await page.addInitScript(() => sessionStorage.setItem("ak-install-prompt-dismissed", "1"));
  await page.request.put(`${app.baseUrl}/api/whats-new/seen`, { data: { id: WHATS_NEW_NEWEST } });
});

/** A calendar day as YYYY-MM-DD in the local time zone, n days from today (the page uses the local day too). */
const day = pinnedDay;

/** The month n months from this one, as YYYY-MM. */
const month = pinnedMonth;

/** The last day of the month n months from this one: the date a month-task or future item carries. */
const lastDay = pinnedLastDay;

/** How far back the cleanup and the stored() reads reach: past the oldest seed of any test here. */
const BACK = -40;

/** Every test starts from an empty log: all entries of the throwaway account go (their traces go with them). */
test.afterEach(async ({ page }) => {
  const response = await page.request.get(`${app.baseUrl}/api/entries?from=${day(BACK)}&to=${lastDay(3)}`);
  for (const entry of (await response.json()).entries as Array<{ id: string }>) await page.request.delete(`${app.baseUrl}/api/entries/${entry.id}`);
});

type Entry = { id: string; date: string; horizon: string; type: string; title: string };
type Trace = { entryId: string; date: string; horizon: string; kind: string; title: string };

/** One fake entry through the API with the page's session. Never a real list. Resolves with its id. */
async function seed(page: Page, data: { date: string; title: string; horizon?: string; type?: string }): Promise<string> {
  const response = await page.request.post(`${app.baseUrl}/api/entries`, { data: { type: "task", ...data } });
  expect(response.status()).toBe(201);
  return (await response.json()).entry.id as string;
}

/** What the API holds from forty days back through the sixth month: the entries and the traces. */
async function stored(page: Page): Promise<{ entries: Entry[]; traces: Trace[] }> {
  const response = await page.request.get(`${app.baseUrl}/api/entries?from=${day(BACK)}&to=${lastDay(3)}&traces=1`);
  return response.json();
}

/** The entry of a title, as the API holds it now. */
async function entryOf(page: Page, text: string): Promise<Entry> {
  return (await stored(page)).entries.find((entry) => entry.title === text)!;
}

const review = (page: Page) => page.getByTestId("migrate-review");
const prompt = (page: Page) => page.getByTestId("migrate-prompt");
const item = (page: Page) => page.getByTestId("migrate-item");
const act = (page: Page, name: "keep" | "schedule" | "drop") => page.getByTestId(`migrate-${name}`);
const chooser = (page: Page) => page.getByTestId("move-chooser");
const live = (page: Page, text: string) => page.locator(".paper-row:not(.paper-trace)", { hasText: text });
const traceRows = (page: Page) => page.getByTestId("trace-row");

/** Opens the log (or a link into it) and waits until its scripts are wired, so a tap is heard. */
async function openLog(page: Page, query = ""): Promise<void> {
  await page.goto(`${app.baseUrl}/${query}`);
  await page.waitForFunction(() => !!document.querySelector(".paper-add"));
}

/** Opens the review from the always-there link and waits for the sheet. */
async function openReview(page: Page): Promise<void> {
  await page.getByTestId("migrate-open").click();
  await expect(review(page)).toBeVisible();
}

/** Closes the review and waits until the sheet is gone. */
async function closeReview(page: Page): Promise<void> {
  await review(page).locator("[data-action=migrate-close]").click();
  await expect(review(page)).toHaveCount(0);
}

test("the quiet prompt shows for an open task of an earlier day, and not only because today has open tasks", async ({ page }) => {
  await seed(page, { date: day(0), title: "Heute offen" });
  await openLog(page);
  await expect(live(page, "Heute offen")).toBeVisible();
  await expect(prompt(page)).toHaveCount(0);

  await seed(page, { date: day(-2), title: "Gestern liegen geblieben" });
  await openLog(page);
  await expect(prompt(page)).toBeVisible();
  await expect(prompt(page)).toContainText("1 open task from earlier days");
  await prompt(page).click();
  await expect(review(page)).toBeVisible();
  await expect(item(page)).toHaveText("Gestern liegen geblieben");
});

test("the always-there action opens the review, with an empty state when nothing is left", async ({ page }) => {
  await openLog(page);
  await expect(prompt(page)).toHaveCount(0);
  await openReview(page);
  await expect(page.getByTestId("migrate-empty")).toContainText("Nothing to migrate");
  await closeReview(page);
});

test("only open daily tasks of earlier days are reviewed: not done, notes, events, marks, month tasks or future items", async ({ page }) => {
  await seed(page, { date: day(-2), title: "Offen alt" });
  await seed(page, { date: day(-2), title: "Erledigt alt", type: "done" });
  await seed(page, { date: day(-2), title: "Notiz alt", type: "note" });
  await seed(page, { date: day(-2), title: "Termin alt", type: "event" });
  await seed(page, { date: day(-2), title: "Weitergereicht alt", type: "migrated" });
  await seed(page, { date: day(-2), title: "Geplant alt", type: "scheduled" });
  await seed(page, { date: lastDay(0), title: "Monatsaufgabe", horizon: "month-task" });
  await seed(page, { date: lastDay(2), title: "Zukunft", horizon: "future" });
  await openLog(page);
  await expect(prompt(page)).toContainText("1 open task from earlier days");
  await prompt(page).click();
  await expect(page.getByTestId("migrate-sub")).toHaveText("Task 1 of 1");
  await expect(item(page)).toHaveText("Offen alt");
  await act(page, "keep").click();
  await expect(page.getByTestId("migrate-kept")).toHaveText("1 kept");
});

test("Keep moves the task to today with the same id, and leaves a > trace on the old day", async ({ page }) => {
  const id = await seed(page, { date: day(-2), title: "Weiter auf heute" });
  await openLog(page);
  await prompt(page).click();
  await expect(item(page)).toHaveText("Weiter auf heute");
  await act(page, "keep").click();
  await expect(page.getByTestId("migrate-summary")).toBeVisible();
  await closeReview(page);

  expect(await entryOf(page, "Weiter auf heute")).toMatchObject({ id, date: day(0), horizon: "day", type: "task" });
  expect((await stored(page)).traces).toEqual([expect.objectContaining({ entryId: id, date: day(-2), kind: "migrated", title: "Weiter auf heute" })]);
  await expect(live(page, "Weiter auf heute")).toHaveAttribute("data-id", id);
  await expect(prompt(page)).toHaveCount(0);

  await openLog(page, `?day=${day(-2)}`);
  await expect(traceRows(page)).toHaveCount(1);
  await expect(traceRows(page)).toHaveAttribute("data-trace", "migrated");
  await expect(live(page, "Weiter auf heute")).toHaveCount(0);
});

test("Schedule opens the schedule chooser, closing it leaves the task open, a pick files it with a < trace", async ({ page }) => {
  const id = await seed(page, { date: day(-2), title: "Später erledigen" });
  await openLog(page);
  await prompt(page).click();
  await act(page, "schedule").click();
  await expect(chooser(page)).toBeVisible();
  await expect(chooser(page)).toHaveAttribute("data-kind", "schedule");
  await expect(chooser(page).locator("[data-dest=here]")).toHaveCount(0);

  // A tap on the paper veil closes the chooser with no pick: the task is still there, still open, and can be decided again.
  await page.getByTestId("move-overlay").click({ position: { x: 4, y: 4 } });
  await expect(chooser(page)).toHaveCount(0);
  await expect(item(page)).toHaveText("Später erledigen");
  expect(await entryOf(page, "Später erledigen")).toMatchObject({ id, date: day(-2), type: "task" });

  await act(page, "schedule").click();
  await chooser(page).locator(`[data-dest="month:${month(1)}"]`).click();
  await expect(page.getByTestId("migrate-scheduled")).toHaveText("1 scheduled");
  await closeReview(page);

  expect(await entryOf(page, "Später erledigen")).toMatchObject({ id, date: lastDay(1), horizon: "future", type: "task" });
  expect((await stored(page)).traces).toEqual([expect.objectContaining({ entryId: id, date: day(-2), kind: "scheduled" })]);
  await openLog(page, `?day=${day(-2)}`);
  await expect(traceRows(page)).toHaveAttribute("data-trace", "scheduled");
});

test("Drop strikes the task through on its old day: same id, not done, not on today, no trace", async ({ page }) => {
  const id = await seed(page, { date: day(-2), title: "Nicht mehr wichtig" });
  await openLog(page);
  await prompt(page).click();
  await act(page, "drop").click();
  await expect(page.getByTestId("migrate-dropped")).toHaveText("1 dropped");
  await closeReview(page);

  expect(await entryOf(page, "Nicht mehr wichtig")).toMatchObject({ id, date: day(-2), horizon: "day", type: "dropped" });
  expect((await stored(page)).traces).toHaveLength(0);
  await expect(live(page, "Nicht mehr wichtig")).toHaveCount(0);
  await expect(prompt(page)).toHaveCount(0);

  await openLog(page, `?day=${day(-2)}`);
  const row = live(page, "Nicht mehr wichtig");
  await expect(row).toHaveAttribute("data-type", "dropped");
  await expect(row).toHaveAttribute("data-id", id);
  await expect(row.locator(".paper-title")).toHaveCSS("text-decoration-line", "line-through");
  await expect(row.getByTestId("toggle-done")).toHaveCount(0);
});

test("Keep all remaining moves every undecided task to today, then shows the summary", async ({ page }) => {
  await seed(page, { date: day(-3), title: "Eins" });
  await seed(page, { date: day(-2), title: "Zwei" });
  await seed(page, { date: day(-1), title: "Drei" });
  await openLog(page);
  await prompt(page).click();
  await expect(item(page)).toHaveText("Eins");
  await act(page, "drop").click();
  await expect(item(page)).toHaveText("Zwei");
  await review(page).locator("[data-action=keep-all]").click();

  await expect(page.getByTestId("migrate-kept")).toHaveText("2 kept");
  await expect(page.getByTestId("migrate-scheduled")).toHaveText("0 scheduled");
  await expect(page.getByTestId("migrate-dropped")).toHaveText("1 dropped");
  await closeReview(page);
  expect(await entryOf(page, "Eins")).toMatchObject({ date: day(-3), type: "dropped" });
  expect(await entryOf(page, "Zwei")).toMatchObject({ date: day(0), type: "task" });
  expect(await entryOf(page, "Drei")).toMatchObject({ date: day(0), type: "task" });
  expect((await stored(page)).traces.map((trace) => trace.kind)).toEqual(["migrated", "migrated"]);
});

test("the summary counts kept, scheduled and dropped, oldest task first", async ({ page }) => {
  await seed(page, { date: day(-4), title: "Alt A" });
  await seed(page, { date: day(-3), title: "Alt B" });
  await seed(page, { date: day(-1), title: "Alt C" });
  await openLog(page);
  await prompt(page).click();
  await expect(page.getByTestId("migrate-sub")).toHaveText("Task 1 of 3");
  await expect(item(page)).toHaveText("Alt A");
  await act(page, "keep").click();
  await expect(item(page)).toHaveText("Alt B");
  await act(page, "schedule").click();
  await chooser(page).locator(`[data-dest="month:${month(1)}"]`).click();
  await expect(item(page)).toHaveText("Alt C");
  await act(page, "drop").click();

  await expect(page.getByTestId("migrate-kept")).toHaveText("1 kept");
  await expect(page.getByTestId("migrate-scheduled")).toHaveText("1 scheduled");
  await expect(page.getByTestId("migrate-dropped")).toHaveText("1 dropped");
  await closeReview(page);
  await expect(page.locator(".paper-page")).toBeVisible();
});

test("closing mid-flow leaves the unreviewed tasks where they were", async ({ page }) => {
  await seed(page, { date: day(-3), title: "Erst" });
  await seed(page, { date: day(-2), title: "Dann" });
  await openLog(page);
  await prompt(page).click();
  await act(page, "keep").click();
  await expect(item(page)).toHaveText("Dann");
  await closeReview(page);

  expect(await entryOf(page, "Erst")).toMatchObject({ date: day(0) });
  expect(await entryOf(page, "Dann")).toMatchObject({ date: day(-2), type: "task" });
  await expect(prompt(page)).toContainText("1 open task from earlier days");
});

test("an open task 30 days old is in the quiet prompt and the review, and Keep moves it to today with a trace on its old day", async ({ page }) => {
  const id = await seed(page, { date: day(-30), title: "Lange liegen geblieben" });
  await seed(page, { date: day(-2), title: "Vorgestern offen" });
  await openLog(page);
  await expect(prompt(page)).toContainText("2 open tasks from earlier days");
  await prompt(page).click();
  await expect(page.getByTestId("migrate-sub")).toHaveText("Task 1 of 2");
  await expect(item(page)).toHaveText("Lange liegen geblieben");
  await act(page, "keep").click();
  await expect(item(page)).toHaveText("Vorgestern offen");
  await act(page, "drop").click();
  await closeReview(page);

  expect(await entryOf(page, "Lange liegen geblieben")).toMatchObject({ id, date: day(0), type: "task" });
  expect((await stored(page)).traces).toEqual([expect.objectContaining({ entryId: id, date: day(-30), kind: "migrated" })]);
  await expect(live(page, "Lange liegen geblieben")).toHaveAttribute("data-id", id);
  await expect(prompt(page)).toHaveCount(0);
});

test("the review marks a task that is not on paper yet with the page mark, and a written one has none", async ({ page }) => {
  const first = await seed(page, { date: day(-3), title: "Schon notiert" });
  await seed(page, { date: day(-2), title: "Noch nicht notiert" });
  expect((await page.request.post(`${app.baseUrl}/api/entries/${first}/written`)).status()).toBe(200);

  await openLog(page);
  await prompt(page).click();
  await expect(item(page)).toHaveText("Schon notiert");
  await expect(page.getByTestId("migrate-sub")).toHaveText("Task 1 of 2");
  await expect(item(page).getByTestId("not-on-paper-mark")).toHaveCount(0);
  await act(page, "drop").click();
  await expect(item(page)).toHaveText("Noch nicht notiert");
  await expect(item(page).getByTestId("not-on-paper-mark")).toHaveCount(1);
  await expect(item(page).getByTestId("not-on-paper-mark")).toHaveAttribute("aria-label", "Not on paper yet");
});

test("old tasks that are done, scheduled, dropped, migrated or moved into a note are not offered", async ({ page }) => {
  await seed(page, { date: day(-30), title: "Noch offen" });
  await seed(page, { date: day(-30), title: "Alt erledigt", type: "done" });
  await seed(page, { date: day(-30), title: "Alt geplant", type: "scheduled" });
  await seed(page, { date: day(-30), title: "Alt verworfen", type: "dropped" });
  await seed(page, { date: day(-30), title: "Alt weitergereicht", type: "migrated" });
  const moved = await seed(page, { date: day(-30), title: "Alt in Notiz" });
  const noteResponse = await page.request.post(`${app.baseUrl}/api/entries`, { data: { date: day(-1), type: "note", title: "Sammelnotiz", body: "# Sammelnotiz\n\nText" } });
  const note = (await noteResponse.json()).entry.id as string;
  const filed = await page.request.post(`${app.baseUrl}/api/entries/${moved}/into-note`, { data: { noteId: note } });
  expect(filed.status()).toBe(200);

  await openLog(page);
  await expect(prompt(page)).toContainText("1 open task from earlier days");
  await prompt(page).click();
  await expect(page.getByTestId("migrate-sub")).toHaveText("Task 1 of 1");
  await expect(item(page)).toHaveText("Noch offen");
});
