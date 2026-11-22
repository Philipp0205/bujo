import { expect, test, type Page } from "@playwright/test";
import { useBujo } from "./harness.ts";
import { addTab, mainBar } from "./scan-helpers.ts";

const app = useBujo();

test.beforeEach(async ({ page }) => {
  await app.signIn(page);
  // The install banner and the what's new sheet would sit over the log, so both are out of the way before any page script runs.
  await page.addInitScript(() => sessionStorage.setItem("ak-install-prompt-dismissed", "1"));
  await page.request.put(`${app.baseUrl}/api/whats-new/seen`, { data: { id: "2026-11-22-future-monthly" } });
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
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth() + ahead, 1);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

/** The last day of the month n months from this one: the date a month-task or future item carries. */
function lastDay(ahead: number): string {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth() + ahead + 1, 0);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "December 2026" for the month n months from this one, as the screen writes it. */
function monthName(ahead: number): string {
  const [year, number] = month(ahead).split("-").map(Number);
  return `${MONTHS[number - 1]} ${year}`;
}

/** Every test starts from an empty log: all entries of the throwaway account go, from last month through the sixth month. */
test.afterEach(async ({ page }) => {
  const response = await page.request.get(`${app.baseUrl}/api/entries?from=${month(0)}-01&to=${lastDay(5)}`);
  for (const entry of (await response.json()).entries as Array<{ id: string }>) await page.request.delete(`${app.baseUrl}/api/entries/${entry.id}`);
  const near = await page.request.get(`${app.baseUrl}/api/entries?from=${day(-6)}&to=${day(7)}`);
  for (const entry of (await near.json()).entries as Array<{ id: string }>) await page.request.delete(`${app.baseUrl}/api/entries/${entry.id}`);
});

type Seed = { date: string; title: string; horizon?: string; type?: string };

/** Fake entries through the API with the page's session. Never a real list. */
async function seed(page: Page, entries: Seed[]): Promise<void> {
  for (const entry of entries) {
    const response = await page.request.post(`${app.baseUrl}/api/entries`, { data: { type: "task", ...entry } });
    expect(response.status()).toBe(201);
  }
}

const switcher = (page: Page) => page.getByTestId("view-switcher");
const tab = (page: Page, name: "future" | "month" | "daily") => page.getByTestId(`view-${name}`);
const body = (page: Page) => page.getByTestId("page-body");
const row = (page: Page, title: string) => page.locator(".paper-row", { hasText: title });
const title = (page: Page) => page.getByRole("textbox", { name: "Entry title" });

/** Opens the log (or a link into it) and waits until its scripts are wired, so a tap is heard. */
async function openLog(page: Page, query = ""): Promise<void> {
  await page.goto(`${app.baseUrl}/${query}`);
  await expect(switcher(page)).toBeVisible();
  await page.waitForFunction(() => !!document.querySelector(".paper-add"));
}

/** Types a line, saves it with Enter, waits for the next empty line (the save is done then) and closes it with Escape. */
async function typeLine(page: Page, text: string): Promise<void> {
  await title(page).fill(text);
  await page.keyboard.press("Enter");
  await expect(title(page)).toHaveValue("");
  await page.keyboard.press("Escape");
  await expect(title(page)).toHaveCount(0);
}

/** The titles the API holds under one date and horizon. */
async function stored(page: Page, date: string, horizon: string): Promise<string[]> {
  const response = await page.request.get(`${app.baseUrl}/api/entries?from=${date}&to=${date}`);
  const entries = (await response.json()).entries as Array<{ title: string; horizon?: string }>;
  return entries.filter((entry) => (entry.horizon ?? "day") === horizon).map((entry) => entry.title);
}

test("the log opens on Daily, and the switcher shows Future, Month and Daily in a row above the date", async ({ page }) => {
  await openLog(page);

  await expect(page.getByRole("heading", { name: "Daily Log", level: 1 })).toBeVisible();
  await expect(switcher(page).getByRole("button")).toHaveText(["Future", "Month", "Daily"]);
  await expect(tab(page, "daily")).toHaveAttribute("aria-pressed", "true");
  await expect(tab(page, "month")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("page-date")).toBeVisible();
  const above = (await switcher(page).boundingBox())!;
  const date = (await page.getByTestId("page-head").boundingBox())!;
  expect(above.y + above.height).toBeLessThanOrEqual(date.y + 1);
});

test("Month shows a dated daily entry once, on its day, and the month-task under Month tasks", async ({ page }) => {
  await seed(page, [
    { date: day(0), title: "Heute erledigen" },
    { date: lastDay(0), title: "Monatsaufgabe", horizon: "month-task" },
  ]);
  await openLog(page);
  await tab(page, "month").click();

  await expect(page.getByRole("heading", { name: "Monthly Log", level: 1 })).toBeVisible();
  await expect(page.getByTestId("month-heading")).toHaveText(monthName(0));
  await expect(page.getByTestId("month-day-label")).toHaveCount(1);
  await expect(row(page, "Heute erledigen")).toHaveCount(1);
  await expect(row(page, "Heute erledigen")).toHaveAttribute("data-horizon", "day");
  await expect(page.getByTestId("month-tasks").locator(".paper-row", { hasText: "Monatsaufgabe" })).toHaveAttribute("data-horizon", "month-task");
  expect(new URL(page.url()).searchParams.get("view")).toBe("month");
  expect(new URL(page.url()).searchParams.get("month")).toBeNull();

  // The month item has no done toggle, and the day entry still has one.
  await expect(row(page, "Monatsaufgabe").getByTestId("toggle-done")).toHaveCount(0);
  await expect(row(page, "Heute erledigen").getByTestId("toggle-done")).toHaveCount(1);

  // The same entry stays on its Daily page, with no copy of it elsewhere.
  await tab(page, "daily").click();
  await expect(row(page, "Heute erledigen")).toHaveCount(1);
  await expect(row(page, "Monatsaufgabe")).toHaveCount(0);
});

test("Month: the arrows move through the six months and stop at both ends, and This month jumps back", async ({ page }) => {
  await openLog(page, "?view=month");

  await expect(page.getByTestId("month-prev")).toBeDisabled();
  await expect(page.getByTestId("month-jump")).toHaveCount(0);
  await page.getByTestId("month-next").click();
  await expect(page.getByTestId("month-heading")).toHaveText(monthName(1));
  await expect(page.getByTestId("month-jump")).toBeVisible();
  expect(new URL(page.url()).searchParams.get("month")).toBe(month(1));
  for (let step = 0; step < 4; step += 1) await page.getByTestId("month-next").click();
  await expect(page.getByTestId("month-heading")).toHaveText(monthName(5));
  await expect(page.getByTestId("month-next")).toBeDisabled();
  await page.getByTestId("month-jump").click();
  await expect(page.getByTestId("month-heading")).toHaveText(monthName(0));
});

test("Future shows six English month headings, empty upcoming ones too, and the future item in its month", async ({ page }) => {
  await seed(page, [
    { date: lastDay(2), title: "Urlaub planen", horizon: "future" },
    { date: lastDay(0), title: "Diesen Monat", horizon: "month-task" },
  ]);
  await openLog(page);
  await tab(page, "future").click();

  await expect(page.getByRole("heading", { name: "Future Log", level: 1 })).toBeVisible();
  const labels = page.getByTestId("future-bucket-label");
  await expect(labels).toHaveCount(6);
  await expect(labels).toHaveText([0, 1, 2, 3, 4, 5].map(monthName));
  await expect(page.getByTestId("future-bucket").nth(2).locator(".paper-row", { hasText: "Urlaub planen" })).toHaveCount(1);
  await expect(page.getByTestId("future-bucket").nth(0).locator(".paper-row", { hasText: "Diesen Monat" })).toHaveCount(1);
  await expect(page.getByTestId("future-bucket").nth(1).locator(".paper-row")).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get("view")).toBe("future");
  await expect(row(page, "Urlaub planen").getByTestId("toggle-done")).toHaveCount(0);
});

test("an @dezember line typed on Daily lands under that month, off the day page", async ({ page }) => {
  await openLog(page);
  await addTab(page).click();
  await typeLine(page, "Jahresrückblick @dez");

  await expect(row(page, "Jahresrückblick")).toHaveCount(0);
  const december = new Date().getMonth() === 11 ? 0 : 11 - new Date().getMonth();
  const date = lastDay(december);
  await expect.poll(() => stored(page, date, december === 0 ? "month-task" : "future")).toEqual(["Jahresrückblick"]);
  await expect.poll(() => stored(page, day(0), "day")).toEqual([]);

  await tab(page, "future").click();
  await expect(page.getByTestId("future-bucket").nth(december).locator(".paper-row", { hasText: "Jahresrückblick" })).toHaveCount(1);
});

test("Add while Month is open makes a month-task, and Add while Future is open makes a future item, in that view", async ({ page }) => {
  await openLog(page, "?view=month");
  await page.locator("[data-action=add-entry]").click();
  await typeLine(page, "Im Monat");
  await expect(page.getByTestId("month-tasks").locator(".paper-row", { hasText: "Im Monat" })).toHaveCount(1);
  await expect.poll(() => stored(page, lastDay(0), "month-task")).toEqual(["Im Monat"]);

  await tab(page, "future").click();
  await page.locator("[data-action=add-entry]").click();
  await typeLine(page, "In der Zukunft");
  await expect(page.getByTestId("future-bucket").nth(1).locator(".paper-row", { hasText: "In der Zukunft" })).toHaveCount(1);
  await expect.poll(() => stored(page, lastDay(1), "future")).toEqual(["In der Zukunft"]);
});

test("a month-task is a task even when the line was an event, because an event needs a day", async ({ page }) => {
  await openLog(page, "?view=month");
  await page.locator("[data-action=add-entry]").click();
  await typeLine(page, "Konferenz");
  await expect(row(page, "Konferenz")).toHaveAttribute("data-type", "task");
});

test("a long month ends above the tab bar: the last row and Add sit fully above it", async ({ page }) => {
  const entries: Seed[] = Array.from({ length: 14 }, (_, i) => ({ date: lastDay(0), title: `Monatsaufgabe ${i + 1}`, horizon: "month-task" }));
  await seed(page, entries);
  await openLog(page, "?view=month");

  await body(page).evaluate((node) => { node.scrollTop = node.scrollHeight; });
  const bar = (await mainBar(page).boundingBox())!;
  const last = (await row(page, "Monatsaufgabe 14").boundingBox())!;
  const add = (await page.locator("[data-action=add-entry]").boundingBox())!;
  expect(last.y + last.height).toBeLessThanOrEqual(bar.y);
  expect(add.y + add.height).toBeLessThanOrEqual(bar.y);
});

test("a long Future Log ends above the tab bar too", async ({ page }) => {
  const entries: Seed[] = Array.from({ length: 10 }, (_, i) => ({ date: lastDay(5), title: `Spaeter ${i + 1}`, horizon: "future" }));
  await seed(page, entries);
  await openLog(page, "?view=future");

  await body(page).evaluate((node) => { node.scrollTop = node.scrollHeight; });
  const bar = (await mainBar(page).boundingBox())!;
  const add = (await page.locator("[data-action=add-entry]").boundingBox())!;
  expect(add.y + add.height).toBeLessThanOrEqual(bar.y);
});

test("the Add row lines up with the text column on every view", async ({ page }) => {
  await openLog(page);
  const columns: number[] = [];
  for (const name of ["daily", "month", "future"] as const) {
    await tab(page, name).click();
    await expect(tab(page, name)).toHaveAttribute("aria-pressed", "true");
    columns.push((await page.locator(".paper-add-text").boundingBox())!.x);
  }
  expect(new Set(columns.map((x) => Math.round(x))).size).toBe(1);
});

test("Not on paper counts a month-task that is not on paper, and lists it under its month", async ({ page }) => {
  await seed(page, [{ date: lastDay(1), title: "Spaeter aufschreiben", horizon: "future" }]);
  await openLog(page);

  await expect(page.getByTestId("not-on-paper-open")).toHaveAttribute("data-count", "1");
  await page.getByTestId("not-on-paper-open").click();
  await expect(page.getByTestId("not-on-paper-month")).toHaveText(monthName(1));
  await expect(page.getByTestId("not-on-paper-row")).toHaveCount(1);
});

test("the switcher, a ?view=month link and the Back layers: a link opens that view and keeps the other parameters", async ({ page }) => {
  await openLog(page, `?view=month&month=${month(2)}`);
  await expect(page.getByTestId("month-heading")).toHaveText(monthName(2));
  await expect(tab(page, "month")).toHaveAttribute("aria-pressed", "true");

  await tab(page, "daily").click();
  await expect(page.getByTestId("page-date")).toBeVisible();
  // The address follows once the day's own read has landed.
  await expect.poll(() => new URL(page.url()).searchParams.get("view")).toBeNull();
  expect(new URL(page.url()).searchParams.get("month")).toBeNull();
});
