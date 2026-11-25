import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { REMIND_FUTURE_KEY, REMIND_MONTHLY_KEY, useBujo, WHATS_NEW_NEWEST } from "./harness.ts";

const app = useBujo();

const OLDEST: string = JSON.parse(readFileSync(new URL("../../public/whats-new.json", import.meta.url), "utf8")).at(-1).id;

test.beforeEach(async ({ page }) => {
  await app.signIn(page);
  // The install banner and the what's new sheet would sit over the log, so both are out of the way before any page script runs.
  await page.addInitScript(() => sessionStorage.setItem("ak-install-prompt-dismissed", "1"));
  await page.request.put(`${app.baseUrl}/api/whats-new/seen`, { data: { id: WHATS_NEW_NEWEST } });
});

const pad = (n: number) => String(n).padStart(2, "0");

/** A calendar day as YYYY-MM-DD in the local time zone, n days from today. */
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

/** Every test starts from an empty log: all entries of the throwaway account go. */
test.afterEach(async ({ page }) => {
  const response = await page.request.get(`${app.baseUrl}/api/entries?from=${day(-40)}&to=${month(5)}-28`);
  for (const entry of (await response.json()).entries as Array<{ id: string }>) await page.request.delete(`${app.baseUrl}/api/entries/${entry.id}`);
});

/** One fake task through the API with the page's session. Never a real list. */
async function seed(page: Page, date: string, title: string): Promise<void> {
  const response = await page.request.post(`${app.baseUrl}/api/entries`, { data: { type: "task", date, title } });
  expect(response.status()).toBe(201);
}

const review = (page: Page) => page.getByTestId("migrate-review");
const monthlyNudge = (page: Page) => page.getByTestId("remind-monthly");
const futureNudge = (page: Page) => page.getByTestId("remind-future");
const stored = (page: Page, key: string) => page.evaluate((k) => localStorage.getItem(k), key);

/** Opens the log and waits until its scripts are wired. */
async function openLog(page: Page): Promise<void> {
  await page.goto(`${app.baseUrl}/`);
  await page.waitForFunction(() => !!document.querySelector(".paper-add"));
}

/** Clears one reminder's stored dismissal (the harness seeds both as dismissed), or sets it to a value. "" means nothing stored. */
async function setStored(page: Page, key: string, value: string): Promise<void> {
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [key, value]);
}

/** Finishes a migration of one earlier task: opens the review, keeps it, and waits for the tally. */
async function migrateOne(page: Page): Promise<void> {
  await page.getByTestId("migrate-open").click();
  await expect(review(page)).toBeVisible();
  await page.getByTestId("migrate-keep").click();
  await expect(page.getByTestId("migrate-summary")).toBeVisible();
}

/** Waits until the review sheet is gone. */
async function reviewGone(page: Page): Promise<void> {
  await expect(review(page)).toHaveCount(0);
}

test("after a finished migration the review offers the monthly log; Open the monthly log closes it and shows Month", async ({ page }) => {
  await seed(page, day(-2), "Alt eins");
  await openLog(page);
  await setStored(page, REMIND_MONTHLY_KEY, "");
  await migrateOne(page);
  await expect(monthlyNudge(page)).toBeVisible();
  await expect(page.getByTestId("remind-monthly-open")).toHaveText("Open the monthly log");

  await page.getByTestId("remind-monthly-open").click();
  await reviewGone(page);
  await expect(page.getByTestId("month-heading")).toBeVisible();
  await expect(page.getByTestId("view-month")).toHaveAttribute("aria-pressed", "true");
  expect(await stored(page, REMIND_MONTHLY_KEY)).toBe(day(0));
});

test("Not now, Close routes and Escape dismiss the monthly nudge for today and leave the Daily view", async ({ page }) => {
  await seed(page, day(-2), "Alt zwei");
  await openLog(page);
  await setStored(page, REMIND_MONTHLY_KEY, "");
  await migrateOne(page);
  await page.getByTestId("remind-monthly-later").click();
  await reviewGone(page);
  await expect(page.getByTestId("view-daily")).toHaveAttribute("aria-pressed", "true");
  expect(await stored(page, REMIND_MONTHLY_KEY)).toBe(day(0));

  // Escape is another way out of the same nudge, on another day.
  await setStored(page, REMIND_MONTHLY_KEY, day(-1));
  await seed(page, day(-3), "Alt drei");
  await openLog(page);
  await migrateOne(page);
  await expect(monthlyNudge(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await reviewGone(page);
  await expect(page.getByTestId("view-daily")).toHaveAttribute("aria-pressed", "true");
  expect(await stored(page, REMIND_MONTHLY_KEY)).toBe(day(0));
});

test("Keep all remaining reaches the tally with the nudge; a second finished migration the same day shows Close only", async ({ page }) => {
  await seed(page, day(-2), "Alt vier");
  await seed(page, day(-3), "Alt fuenf");
  await openLog(page);
  await setStored(page, REMIND_MONTHLY_KEY, "");
  await page.getByTestId("migrate-open").click();
  await review(page).locator("[data-action=keep-all]").click();
  await expect(monthlyNudge(page)).toBeVisible();
  await page.getByTestId("remind-monthly-later").click();
  await reviewGone(page);

  await seed(page, day(-4), "Alt sechs");
  await openLog(page);
  await migrateOne(page);
  await expect(monthlyNudge(page)).toHaveCount(0);
  await expect(review(page).locator("[data-action=migrate-close]")).toBeVisible();
});

test("yesterday's dismissal does not hide the monthly nudge", async ({ page }) => {
  await seed(page, day(-2), "Alt sieben");
  await openLog(page);
  await setStored(page, REMIND_MONTHLY_KEY, day(-1));
  await migrateOne(page);
  await expect(monthlyNudge(page)).toBeVisible();
});

test("no monthly nudge on an empty review or when the review is closed early", async ({ page }) => {
  await openLog(page);
  await setStored(page, REMIND_MONTHLY_KEY, "");
  await page.getByTestId("migrate-open").click();
  await expect(page.getByTestId("migrate-empty")).toBeVisible();
  await expect(monthlyNudge(page)).toHaveCount(0);
  await review(page).locator("[data-action=migrate-close]").click();
  await reviewGone(page);

  await seed(page, day(-2), "Alt acht");
  await openLog(page);
  await page.getByTestId("migrate-open").click();
  await expect(review(page)).toBeVisible();
  await review(page).locator("[data-action=migrate-close]").click();
  await reviewGone(page);
  expect(await stored(page, REMIND_MONTHLY_KEY)).toBe("");
});

/** Reloads the log with the future-log dismissal cleared (or set), as on the first open of a month. */
async function firstOpen(page: Page, value = ""): Promise<void> {
  await openLog(page);
  await setStored(page, REMIND_FUTURE_KEY, value);
  await openLog(page);
}

test("the first open of a month shows the future-log nudge; Open the future log goes to Future", async ({ page }) => {
  await firstOpen(page);
  await expect(futureNudge(page)).toBeVisible();
  await expect(page.getByTestId("remind-future-open")).toHaveText("Open the future log");
  await page.getByTestId("remind-future-open").click();
  await expect(futureNudge(page)).toHaveCount(0);
  await expect(page.getByTestId("future-heading")).toBeVisible();
  await expect(page.getByTestId("view-future")).toHaveAttribute("aria-pressed", "true");
  expect(await stored(page, REMIND_FUTURE_KEY)).toBe(month(0));
});

test("Not now dismisses the future nudge without changing the view, and a reload does not show it again", async ({ page }) => {
  await firstOpen(page);
  await page.getByTestId("remind-future-later").click();
  await expect(futureNudge(page)).toHaveCount(0);
  await expect(page.getByTestId("view-daily")).toHaveAttribute("aria-pressed", "true");
  expect(await stored(page, REMIND_FUTURE_KEY)).toBe(month(0));

  await openLog(page);
  await expect(page.getByTestId("view-daily")).toBeVisible();
  await expect(futureNudge(page)).toHaveCount(0);
});

test("Escape dismisses the future nudge for the month", async ({ page }) => {
  await firstOpen(page);
  await expect(futureNudge(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(futureNudge(page)).toHaveCount(0);
  expect(await stored(page, REMIND_FUTURE_KEY)).toBe(month(0));
});

test("a dismissal from last month shows the future nudge again", async ({ page }) => {
  await firstOpen(page, month(-1));
  await expect(futureNudge(page)).toBeVisible();
});

test("the future nudge waits for the what's new sheet and then shows", async ({ page }) => {
  await openLog(page);
  await setStored(page, REMIND_FUTURE_KEY, "");
  await page.evaluate(() => localStorage.removeItem("bujo-whats-new-seen"));
  await page.request.put(`${app.baseUrl}/api/whats-new/seen`, { data: { id: OLDEST } });
  await openLog(page);
  const sheet = page.getByTestId("whats-new-sheet");
  await expect(sheet).toBeVisible();
  await expect(futureNudge(page)).toHaveCount(0);

  await page.locator("[data-action=whats-new-done]").click();
  await expect(sheet).toHaveCount(0);
  await expect(futureNudge(page)).toBeVisible();
});
