import { expect, test, type Page } from "@playwright/test";
import { PINNED_NOW, pinClock, pinnedDay, useBujo, WHATS_NEW_NEWEST } from "./harness.ts";

const app = useBujo();

test.beforeEach(async ({ page }) => {
  await app.signIn(page);
  await pinClock(page);
  // The install banner and the what's new sheet would sit over the log, so both are out of the way before any page script runs.
  await page.addInitScript(() => sessionStorage.setItem("ak-install-prompt-dismissed", "1"));
  await page.request.put(`${app.baseUrl}/api/whats-new/seen`, { data: { id: WHATS_NEW_NEWEST } });
});

/** The pages are the days that have entries, so every test starts from an empty log: all entries of the throwaway account go. */
test.afterEach(async ({ page }) => {
  const response = await page.request.get(`${app.baseUrl}/api/entries?from=${day(-6)}&to=${day(40)}`);
  for (const entry of (await response.json()).entries as Array<{ id: string }>) await page.request.delete(`${app.baseUrl}/api/entries/${entry.id}`);
});

/** A calendar day n days from the pinned today (the page's clock is pinned to the same moment). */
const day = pinnedDay;

type Seed = { offset: number; type?: string; title: string };

/** Fake entries through the API with the page's session. Never a real list. */
async function seed(page: Page, entries: Seed[]): Promise<void> {
  for (const entry of entries) {
    const response = await page.request.post(`${app.baseUrl}/api/entries`, { data: { date: day(entry.offset), type: entry.type ?? "task", title: entry.title } });
    expect(response.status()).toBe(201);
  }
}

/** The titles the API holds on one day. */
async function storedTitles(page: Page, offset: number): Promise<string[]> {
  const response = await page.request.get(`${app.baseUrl}/api/entries?from=${day(offset)}&to=${day(offset)}`);
  return ((await response.json()).entries as Array<{ title: string }>).map((entry) => entry.title);
}

const body = (page: Page) => page.getByTestId("page-body");
const row = (page: Page, title: string) => page.locator(".paper-row", { hasText: title });

/** Opens the log (today, or the page of a link) and waits until its scripts are wired, so a tap or a swipe is heard. */
async function openLog(page: Page, offset?: number): Promise<void> {
  await page.goto(offset === undefined ? app.baseUrl : `${app.baseUrl}/?day=${day(offset)}`);
  await expect(page.getByRole("heading", { name: "Daily Log", level: 1 })).toBeVisible();
  await page.waitForFunction(() => !!document.querySelector(".paper-add"));
}

/** The day of the page on screen. */
async function shown(page: Page): Promise<string | null> {
  return body(page).getAttribute("data-date");
}

/** Opens the day picker on a page shown at the given day offset and taps today (steps to the next month first when today lies in it). */
async function pickToday(page: Page, shownOffset: number): Promise<void> {
  await page.getByTestId("page-date").click();
  if (day(shownOffset).slice(0, 7) !== day(0).slice(0, 7)) await page.getByTestId(shownOffset < 0 ? "picker-next" : "picker-prev").click();
  await page.locator(`[data-testid=picker-day][data-date="${day(0)}"]`).click();
}

/** The ?day= of the address, or null. */
function addressDay(page: Page): string | null {
  return new URL(page.url()).searchParams.get("day");
}

/** A swipe with the mouse on the bare paper below the rows, clear of the screen edge. Negative dx is a swipe to the left. */
async function swipeOnPaper(page: Page, dx: number, dy = 0): Promise<void> {
  const box = (await body(page).boundingBox())!;
  const x = dx < 0 ? box.x + box.width - 60 : box.x + 60;
  const y = box.y + box.height - 40;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
}

/** A swipe to the right with the mouse that starts on a row. The page's timers are frozen first: a slow machine must not let the 500 ms row hold fire between press and move. */
async function swipeRowRight(page: Page, title: string): Promise<void> {
  await page.waitForLoadState("networkidle");
  const box = (await row(page, title).boundingBox())!;
  const x = box.x + 60;
  const y = box.y + box.height / 2;
  await page.clock.install({ time: PINNED_NOW });
  await page.clock.pauseAt(new Date(PINNED_NOW.getTime() + 60_000));
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 70, y, { steps: 4 });
  await page.mouse.move(x + 140, y, { steps: 4 });
  await page.mouse.up();
}

test("today opens by default, with its heading, the Today mark, the page number and the add row", async ({ page }) => {
  await seed(page, [{ offset: -3, title: "Vor Tagen" }, { offset: 2, title: "Bald" }]);
  await openLog(page);

  await expect(body(page)).toHaveAttribute("data-date", day(0));
  await expect(page.locator(".paper-day")).toHaveCount(1);
  await expect(page.locator(".paper-day[data-date]")).toHaveAttribute("data-date", day(0));
  await expect(page.getByTestId("today-mark")).toHaveText("Today");
  // Today is an empty page between two days with entries, so it is page 2.
  await expect(page.getByTestId("page-folio")).toHaveText("2");
  await expect(page.locator("[data-action=add-entry]")).toHaveText("+ Add entry");
  await expect(page.getByTestId("today-jump")).toHaveCount(0);
  expect(addressDay(page)).toBeNull();
});

test("another day shows its own date and no Today mark or chip, and the picker brings today back", async ({ page }) => {
  await seed(page, [{ offset: -3, title: "Vor Tagen" }, { offset: 2, title: "Bald" }]);
  await openLog(page);
  const heading = (offset: number) => new Date(`${day(offset)}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" }) + ` ${day(offset).slice(8)}.${day(offset).slice(5, 7)}`;

  for (const offset of [-3, 2]) {
    await page.goto(`${app.baseUrl}/?day=${day(offset)}`);
    await expect(body(page)).toHaveAttribute("data-date", day(offset));
    await expect(page.getByTestId("page-date")).toHaveText(heading(offset));
    await expect(page.getByTestId("page-date")).not.toContainText("Today");
    await expect(page.getByTestId("today-mark")).toHaveCount(0);
    await expect(page.getByTestId("today-jump")).toHaveCount(0);
  }

  await pickToday(page, 2);
  await expect(body(page)).toHaveAttribute("data-date", day(0));
  await expect(page.getByTestId("page-date")).toHaveText(heading(0));
  await expect(page.getByTestId("today-mark")).toHaveText("Today");
  await expect(page.getByTestId("today-jump")).toHaveCount(0);
});

test("the arrows turn to the next page that has entries and stop at the ends", async ({ page }) => {
  await seed(page, [{ offset: -3, title: "Vor Tagen" }, { offset: 2, title: "Bald" }]);
  await openLog(page);

  await page.getByTestId("page-next").click();
  await expect(body(page)).toHaveAttribute("data-date", day(2));
  await expect(row(page, "Bald")).toBeVisible();
  await expect(page.getByTestId("page-folio")).toHaveText("3");
  await expect(page.getByTestId("page-next")).toBeDisabled();
  await expect.poll(() => addressDay(page)).toBe(day(2));

  await page.getByTestId("page-prev").click();
  await expect(body(page)).toHaveAttribute("data-date", day(0));
  await expect.poll(() => addressDay(page)).toBeNull();

  await page.getByTestId("page-prev").click();
  await expect(body(page)).toHaveAttribute("data-date", day(-3));
  await expect(page.getByTestId("page-folio")).toHaveText("1");
  await expect(page.getByTestId("page-prev")).toBeDisabled();
  await expect(row(page, "Vor Tagen")).toBeVisible();
  await expect(page.getByTestId("page-edge-prev")).toHaveCount(0);
});

test("the edge strips turn the page with one tap", async ({ page }) => {
  await seed(page, [{ offset: -1, title: "Gestern" }, { offset: 1, title: "Morgen" }]);
  await openLog(page);

  await page.getByTestId("page-edge-next").click();
  await expect(body(page)).toHaveAttribute("data-date", day(1));
  await expect(page.getByTestId("page-edge-next")).toHaveCount(0);
  await page.getByTestId("page-edge-prev").click();
  await page.getByTestId("page-edge-prev").click();
  await expect(body(page)).toHaveAttribute("data-date", day(-1));
});

test("a swipe from the bare paper turns the page and skips the days without entries", async ({ page }) => {
  await seed(page, [{ offset: -4, title: "Weit zurueck" }, { offset: 5, title: "Weit voraus" }]);
  await openLog(page);

  await swipeOnPaper(page, -140);
  await expect(body(page)).toHaveAttribute("data-date", day(5));
  await expect(row(page, "Weit voraus")).toBeVisible();

  await swipeOnPaper(page, 140);
  await expect(body(page)).toHaveAttribute("data-date", day(0));
  await swipeOnPaper(page, 140);
  await expect(body(page)).toHaveAttribute("data-date", day(-4));

  // No page before the first one: the swipe changes nothing, and neither does a mostly vertical one.
  await swipeOnPaper(page, 140);
  await expect(body(page)).toHaveAttribute("data-date", day(-4));
  await swipeOnPaper(page, -70, 90);
  await expect(body(page)).toHaveAttribute("data-date", day(-4));
});

test("the day picker marks the days with entries, turns to one with a tap and closes", async ({ page }) => {
  // The clock is pinned mid-month, so +3 and +1 stay in the month the picker shows.
  const far = 3;
  const unmarked = 1;
  await seed(page, [{ offset: -2, title: "Gestern oder so" }, { offset: far, title: "In drei Tagen" }]);
  await openLog(page);

  await page.getByTestId("page-date").click();
  const picker = page.getByTestId("day-picker");
  await expect(picker).toBeVisible();
  const cell = (offset: number) => picker.locator(`[data-testid=picker-day][data-date="${day(offset)}"]`);
  await expect(cell(0)).toHaveAttribute("data-selected", "true");
  await expect(cell(0)).toHaveAttribute("data-today", "true");
  await expect(cell(-2)).toHaveAttribute("data-marked", "true");
  await expect(cell(far)).toHaveAttribute("data-marked", "true");
  // A day without entries cannot be chosen, and the tap of a day with entries turns to it and closes the picker.
  await expect(cell(unmarked)).toBeDisabled();
  await cell(far).click();
  await expect(picker).toHaveCount(0);
  await expect(body(page)).toHaveAttribute("data-date", day(far));
  await expect(row(page, "In drei Tagen")).toBeVisible();
  await expect.poll(() => addressDay(page)).toBe(day(far));
});

test("Escape closes the day picker first and stays on the page", async ({ page }) => {
  await seed(page, [{ offset: 1, title: "Morgen" }]);
  await openLog(page);

  await page.getByTestId("page-date").click();
  await expect(page.getByTestId("day-picker")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("day-picker")).toHaveCount(0);
  await expect(body(page)).toHaveAttribute("data-date", day(0));
  await expect(page.getByTestId("page-date")).toBeFocused();
});

test("the phone's Back closes the day picker first and leaves the log on the same page", async ({ page }) => {
  await seed(page, [{ offset: 1, title: "Morgen" }]);
  await page.goto(`${app.baseUrl}/settings`);
  await openLog(page, 1);

  await page.getByTestId("page-date").click();
  await expect(page.getByTestId("day-picker")).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId("day-picker")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Daily Log", level: 1 })).toBeVisible();
  await expect(body(page)).toHaveAttribute("data-date", day(1));
  await expect.poll(() => addressDay(page)).toBe(day(1));
});

test("the day heading opens the picker, which is the way back to today from another page", async ({ page }) => {
  await seed(page, [{ offset: -2, title: "Vorgestern" }, { offset: 0, title: "Heute" }]);
  await openLog(page, -2);

  await expect(body(page)).toHaveAttribute("data-date", day(-2));
  await expect(page.getByTestId("today-mark")).toHaveCount(0);
  await pickToday(page, -2);
  await expect(body(page)).toHaveAttribute("data-date", day(0));
  await expect(page.getByTestId("today-mark")).toBeVisible();
  await expect.poll(() => addressDay(page)).toBeNull();
});

test("only today's page head shows the Today mark: yesterday and a future day show no Today pill", async ({ page }) => {
  await seed(page, [{ offset: -1, title: "Gestern" }, { offset: 0, title: "Heute" }, { offset: 3, title: "Bald" }]);
  await openLog(page);
  await expect(page.getByTestId("today-mark")).toBeVisible();
  await expect(page.getByTestId("today-mark")).toHaveText("Today");

  for (const offset of [-1, 3]) {
    await openLog(page, offset);
    await expect(body(page)).toHaveAttribute("data-date", day(offset));
    await expect(page.getByTestId("today-mark")).toHaveCount(0);
    await expect(page.getByTestId("today-jump")).toHaveCount(0);
    await expect(page.getByTestId("page-date")).not.toContainText("Today");
    await expect(page.getByTestId("page-head")).not.toContainText("Today");
  }
});

test("+ Add entry on another page writes to that day and the entry is still there after a reload", async ({ page }) => {
  await seed(page, [{ offset: 2, title: "Schon da" }]);
  await openLog(page, 2);

  await page.locator("[data-action=add-entry]").click();
  await page.keyboard.type("Neue Zeile");
  await page.keyboard.press("Enter");
  await expect(row(page, "Neue Zeile")).toBeVisible();

  await expect.poll(() => storedTitles(page, 2)).toEqual(["Schon da", "Neue Zeile"]);
  expect(await storedTitles(page, 0)).toEqual([]);

  // The kit drops the sheet's history entry with history.go(-1). Wait until that has landed, so the reload is not cut short by it.
  await expect.poll(() => page.evaluate(() => history.state)).toBeNull();
  await page.reload();
  await expect(body(page)).toHaveAttribute("data-date", day(2));
  await expect(row(page, "Neue Zeile")).toBeVisible();
  await expect(row(page, "Schon da")).toBeVisible();
});

test("a tap on a bullet marks a task done, and a swipe right on a row opens the migrate chooser and does not turn the page", async ({ page }) => {
  await seed(page, [{ offset: 0, title: "Erste Aufgabe" }, { offset: 0, title: "Zweite Aufgabe" }, { offset: 2, title: "Spaeter" }]);
  await openLog(page);

  await row(page, "Erste Aufgabe").getByTestId("toggle-done").click();
  await expect(row(page, "Erste Aufgabe")).toHaveAttribute("data-type", "done");
  await expect(body(page)).toHaveAttribute("data-date", day(0));

  await swipeRowRight(page, "Zweite Aufgabe");
  await expect(page.getByTestId("move-chooser")).toHaveAttribute("data-kind", "migrate");
  await expect(row(page, "Zweite Aufgabe")).toHaveAttribute("data-type", "task");
  await expect(body(page)).toHaveAttribute("data-date", day(0));
  await expect(page.getByTestId("page-next")).toBeEnabled();
});

test("a swipe from the empty paper turns the page and marks nothing done", async ({ page }) => {
  await seed(page, [{ offset: 0, title: "Bleibt offen" }, { offset: 2, title: "Spaeter" }]);
  await openLog(page);

  await swipeOnPaper(page, -140);
  await expect(body(page)).toHaveAttribute("data-date", day(2));
  await expect(row(page, "Spaeter")).toHaveAttribute("data-type", "task");

  await page.getByTestId("page-prev").click();
  await expect(row(page, "Bleibt offen")).toHaveAttribute("data-type", "task");
  const response = await page.request.get(`${app.baseUrl}/api/entries?from=${day(0)}&to=${day(2)}`);
  const types = ((await response.json()).entries as Array<{ type: string }>).map((entry) => entry.type);
  expect(types).toEqual(["task", "task"]);
});

test("a ?day= link opens that page, also beyond the usual window", async ({ page }) => {
  await seed(page, [{ offset: 3, title: "Nah" }, { offset: 20, title: "Fern" }]);

  await openLog(page, 3);
  await expect(body(page)).toHaveAttribute("data-date", day(3));
  await expect(row(page, "Nah")).toBeVisible();
  await expect.poll(() => addressDay(page)).toBe(day(3));

  await openLog(page, 20);
  await expect(body(page)).toHaveAttribute("data-date", day(20));
  await expect(row(page, "Fern")).toBeVisible();
  expect(addressDay(page)).toBe(day(20));
});

test("a ?day= link to a day without a page, or to nonsense, falls back to today", async ({ page }) => {
  await seed(page, [{ offset: 3, title: "Nah" }]);

  await page.goto(`${app.baseUrl}/?day=${day(5)}`);
  await expect(body(page)).toHaveAttribute("data-date", day(0));
  await expect.poll(() => addressDay(page)).toBeNull();

  await page.goto(`${app.baseUrl}/?day=2026-13-45`);
  await expect(body(page)).toHaveAttribute("data-date", day(0));
  await page.goto(`${app.baseUrl}/?day=1999-01-01`);
  await expect(body(page)).toHaveAttribute("data-date", day(0));
});

/** The sheet is the scroller: #log holds the title, the switcher, the date row and the rows, and the window never scrolls. */
const sheet = (page: Page) => page.locator("#log");

/** Scrolls the sheet by a distance and waits two frames for the paint. */
async function scrollSheet(page: Page, top: number | "end"): Promise<void> {
  await sheet(page).evaluate((node, to) => { node.scrollTop = to === "end" ? node.scrollHeight : to; }, top);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/** True when a node is wholly above the top of the screen (scrolled away with the sheet). */
async function offScreenTop(node: ReturnType<Page["getByTestId"]>): Promise<boolean> {
  const box = (await node.boundingBox())!;
  return box.y + box.height <= 0;
}

test("a long page scrolls as one sheet: its last row sits clear of the tab bar and the header went up with the rows", async ({ page }) => {
  const titles = Array.from({ length: 24 }, (_, index) => `Zeile ${String(index + 1).padStart(2, "0")}`);
  await seed(page, titles.map((title) => ({ offset: 0, title })));
  await openLog(page);

  await scrollSheet(page, "end");
  const last = (await row(page, "Zeile 24").boundingBox())!;
  const add = (await page.locator("[data-action=add-entry]").boundingBox())!;
  const bar = (await page.getByRole("navigation", { name: "Main" }).boundingBox())!;
  expect(last.y + last.height).toBeLessThanOrEqual(bar.y);
  expect(add.y + add.height).toBeLessThanOrEqual(bar.y);
  // The window itself does not scroll: the sheet inside it does, and the header is gone with the rows.
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(await offScreenTop(page.getByTestId("view-switcher"))).toBe(true);
  expect(await offScreenTop(page.getByTestId("page-head"))).toBe(true);
});

test("a mid-page scroll moves the switcher and the date row off the screen with the rows, and they come back at the top", async ({ page }) => {
  const titles = Array.from({ length: 24 }, (_, index) => `Zeile ${String(index + 1).padStart(2, "0")}`);
  await seed(page, titles.map((title) => ({ offset: 0, title })));
  await openLog(page);

  const switcherTop = (await page.getByTestId("view-switcher").boundingBox())!.y;
  const dateTop = (await page.getByTestId("page-head").boundingBox())!.y;
  const rowTop = (await row(page, "Zeile 01").boundingBox())!.y;
  await scrollSheet(page, 300);
  expect(await sheet(page).evaluate((node) => node.scrollTop)).toBe(300);
  expect((await page.getByTestId("view-switcher").boundingBox())!.y).toBe(switcherTop - 300);
  expect((await page.getByTestId("page-head").boundingBox())!.y).toBe(dateTop - 300);
  expect((await row(page, "Zeile 01").boundingBox())!.y).toBe(rowTop - 300);
  expect(await offScreenTop(page.getByTestId("view-switcher"))).toBe(true);
  expect(await offScreenTop(page.getByTestId("page-head"))).toBe(true);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  await scrollSheet(page, 0);
  await expect(page.getByTestId("view-switcher")).toBeInViewport();
  await expect(page.getByTestId("page-date")).toBeInViewport();
});

test("a page turn from mid-page starts the new page at the top with its header visible, a redraw of the same day keeps the scroll", async ({ page }) => {
  const titles = Array.from({ length: 24 }, (_, index) => `Zeile ${String(index + 1).padStart(2, "0")}`);
  await seed(page, [...titles.map((title) => ({ offset: 0, title })), { offset: 1, title: "Morgen" }]);
  await openLog(page);

  await scrollSheet(page, 300);
  // A redraw of the same day (the editor opens and closes) keeps the place.
  await row(page, "Zeile 10").click();
  await expect(page.getByTestId("edit-sheet")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("edit-sheet")).toBeHidden();
  expect(await sheet(page).evaluate((node) => node.scrollTop)).toBeGreaterThan(0);

  // The edge strip is on screen though the arrows are not: one tap turns the page.
  await page.mouse.click(382, 400);
  await expect(body(page)).toHaveAttribute("data-date", day(1));
  expect(await sheet(page).evaluate((node) => node.scrollTop)).toBe(0);
  await expect(page.getByTestId("view-switcher")).toBeInViewport();
  await expect(page.getByTestId("page-date")).toBeInViewport();
  await expect(row(page, "Morgen")).toBeVisible();
});
