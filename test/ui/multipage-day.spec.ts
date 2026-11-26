import { expect, test, type Page } from "@playwright/test";
import { line } from "../fake-ocr.ts";
import { useBujo } from "./harness.ts";
import { openScan } from "./scan-helpers.ts";

const app = useBujo();

// A 1x1 PNG. The fake OCR service ignores the pixels and answers the lines the test sets.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const photo = { name: "page.png", mimeType: "image/png", buffer: PNG };

test.beforeEach(async ({ page }) => {
  await app.signIn(page);
  await page.addInitScript(() => sessionStorage.setItem("ak-install-prompt-dismissed", "1"));
  app.ocr.failWith(0);
  app.ocr.delay(0);
});

/** A calendar day as YYYY-MM-DD in the local time zone, n days from today. */
function day(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const headerLine = (iso: string) => line("none", `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`, 0.9);
const review = (page: Page) => page.getByTestId("scan-review");

/** The day heading as the review words it: "Wednesday 18.11". */
function heading(iso: string): string {
  const [year, month, dayOfMonth] = iso.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, dayOfMonth)).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
  return `${weekday} ${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
}

/** Every entry of the days the tests use goes after each test. */
test.afterEach(async ({ page }) => {
  const { entries } = await (await page.request.get(`${app.baseUrl}/api/entries?from=${day(-5)}&to=${day(1)}`)).json();
  for (const entry of entries) await page.request.delete(`${app.baseUrl}/api/entries/${entry.id}`);
});

/** Files page 1 of a day through the API (scan, then apply every line), as a person who scanned it earlier. */
async function seedPage(page: Page, date: string, titles: string[]): Promise<void> {
  app.ocr.setLines([headerLine(date), ...titles.map((title) => line("•", title, 0.9))]);
  const scan = await page.request.post(`${app.baseUrl}/api/log/scan?date=${date}`, { headers: { "content-type": "image/png" }, data: PNG });
  const draft = (await scan.json()).draft;
  const items = draft.items.map((i: any) => ({ id: i.id, type: i.type, title: i.title, tags: i.tags, time: i.time }));
  const applied = await page.request.post(`${app.baseUrl}/api/log/scan/${draft.id}/apply`, { data: { date, page: 1, items } });
  expect(applied.status()).toBe(200);
}

/** Opens the review of a photo with no date header, through the Scan tab. */
async function scanNoHeader(page: Page, titles: string[]): Promise<void> {
  app.ocr.setLines(titles.map((title) => line("•", title, 0.9)));
  await page.goto(app.baseUrl);
  await (await openScan(page)).setFiles(photo);
  await expect(review(page)).toBeVisible();
}

test("a page with no date continues the latest day, says so, and Save lands there on page 2", async ({ page }) => {
  await seedPage(page, day(-1), ["Alpha", "Bravo"]);
  await scanNoHeader(page, ["Charlie", "Delta"]);
  await expect(page.getByTestId("scan-date-source")).toContainText("Continues");
  await expect(page.getByTestId("scan-date-source")).toContainText("no date on this page");
  await expect(page.getByTestId("scan-continue-today")).toBeVisible();
  await expect(page.locator("[data-testid=scan-pages] [data-page='2']")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("scan-page-note")).toContainText("A new page");

  await review(page).locator("[data-action=apply]").click();
  await expect(review(page)).toHaveCount(0);
  await expect(page.locator(".paper-row:not(.paper-trace) .paper-title")).toHaveText(["Alpha", "Bravo", "Charlie", "Delta"]);
  const stored = await page.request.get(`${app.baseUrl}/api/entries?from=${day(0)}&to=${day(0)}`);
  expect((await stored.json()).entries).toHaveLength(0);
});

test("Use today instead moves the day to today and words the source as a fallback", async ({ page }) => {
  await seedPage(page, day(-1), ["Alpha"]);
  await scanNoHeader(page, ["Charlie"]);
  const continued = await page.getByTestId("scan-date").textContent();
  await page.getByTestId("scan-continue-today").click();
  await expect(page.getByTestId("scan-date-source")).toHaveText("Today, no date found");
  await expect(page.getByTestId("scan-continue-today")).toBeHidden();
  await expect(page.getByTestId("scan-date")).not.toHaveText(continued ?? "");
  await expect(page.getByTestId("scan-date")).toHaveText(heading(day(0)));
  await expect(page.getByTestId("scan-page-row")).toBeVisible();
  await expect(page.locator("[data-testid=scan-pages] [data-page='2']")).toHaveAttribute("aria-pressed", "true");

  await review(page).locator("[data-action=apply]").click();
  await expect(review(page)).toHaveCount(0);
  const today = await page.request.get(`${app.baseUrl}/api/entries?from=${day(0)}&to=${day(0)}`);
  expect((await today.json()).entries.map((e: { title: string }) => e.title)).toEqual(["Charlie"]);
});

const pressed = (page: Page, n: number) => page.locator(`[data-testid=scan-pages] [data-page='${n}']`);

/** The titles of a day as the server lists them, with their page. */
async function dayEntries(page: Page, date: string): Promise<Array<{ title: string; page: number | null }>> {
  const response = await page.request.get(`${app.baseUrl}/api/entries?from=${date}&to=${date}`);
  return (await response.json()).entries.map((e: { title: string; page: number | null }) => ({ title: e.title, page: e.page }));
}

test("a dated page that is page 2 of its day files on that date after page 1, and the page can be changed", async ({ page }) => {
  await seedPage(page, day(-1), ["Alpha"]);
  app.ocr.setLines([headerLine(day(-1)), line("•", "Charlie", 0.9)]);
  await page.goto(app.baseUrl);
  await (await openScan(page)).setFiles(photo);
  await expect(review(page)).toBeVisible();
  await expect(page.getByTestId("scan-date")).toHaveText(heading(day(-1)));
  await expect(page.getByTestId("scan-date-source")).toHaveText("Read from the page");
  await expect(page.getByTestId("scan-continue-today")).toBeHidden();
  await expect(page.getByTestId("scan-page-row")).toBeVisible();
  await expect(pressed(page, 2)).toHaveAttribute("aria-pressed", "true");

  await pressed(page, 3).click();
  await expect(pressed(page, 3)).toHaveAttribute("aria-pressed", "true");
  await review(page).locator("[data-action=apply]").click();
  await expect(review(page)).toHaveCount(0);
  expect(await dayEntries(page, day(-1))).toEqual([{ title: "Alpha", page: 1 }, { title: "Charlie", page: 3 }]);
});

test("a dated page saved with its default page 2 lands after page 1", async ({ page }) => {
  await seedPage(page, day(-1), ["Alpha"]);
  app.ocr.setLines([headerLine(day(-1)), line("•", "Charlie", 0.9)]);
  await page.goto(app.baseUrl);
  await (await openScan(page)).setFiles(photo);
  await expect(pressed(page, 2)).toHaveAttribute("aria-pressed", "true");
  await review(page).locator("[data-action=apply]").click();
  await expect(review(page)).toHaveCount(0);
  expect(await dayEntries(page, day(-1))).toEqual([{ title: "Alpha", page: 1 }, { title: "Charlie", page: 2 }]);
});

test("Use today instead keeps page 2 and the picker, and Save files page 2 of today", async ({ page }) => {
  await seedPage(page, day(-1), ["Alpha"]);
  await scanNoHeader(page, ["Charlie"]);
  await expect(pressed(page, 2)).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("scan-continue-today").click();
  await expect(page.getByTestId("scan-date")).toHaveText(heading(day(0)));
  await expect(page.getByTestId("scan-page-row")).toBeVisible();
  await expect(pressed(page, 2)).toHaveAttribute("aria-pressed", "true");
  await review(page).locator("[data-action=apply]").click();
  await expect(review(page)).toHaveCount(0);
  expect(await dayEntries(page, day(0))).toEqual([{ title: "Charlie", page: 2 }]);
});

test("changing the day with the date control keeps page 3", async ({ page }) => {
  await seedPage(page, day(-1), ["Alpha"]);
  await scanNoHeader(page, ["Charlie"]);
  await pressed(page, 3).click();
  await page.locator("[data-field=date]").fill(day(-2));
  await expect(page.getByTestId("scan-date")).toHaveText(heading(day(-2)));
  await expect(pressed(page, 3)).toHaveAttribute("aria-pressed", "true");
  await review(page).locator("[data-action=apply]").click();
  await expect(review(page)).toHaveCount(0);
  expect(await dayEntries(page, day(-2))).toEqual([{ title: "Charlie", page: 3 }]);
});

test("a first scan of a day with no paper shows pages 1 to 3, defaults to page 1 and never says page 0", async ({ page }) => {
  await scanNoHeader(page, ["Alpha"]);
  await expect(page.getByTestId("scan-page-row")).toBeVisible();
  await expect(page.locator("[data-testid=scan-pages] [data-page]")).toHaveText(["Page 1", "Page 2", "Page 3"]);
  await expect(pressed(page, 1)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("scan-page-note")).not.toContainText("page 0");
  await expect(page.getByTestId("scan-page-note")).not.toBeEmpty();
});

test("a rescan of a day page stays on that day, with no continuation row", async ({ page }) => {
  await seedPage(page, day(-2), ["Alpha"]);
  await seedPage(page, day(-1), ["Bravo"]);
  await page.goto(`${app.baseUrl}/?day=${day(-2)}`);
  app.ocr.setLines([line("•", "Alpha", 0.9), line("•", "Zulu", 0.9)]);
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByTestId("rescan-page").click()]);
  await chooser.setFiles(photo);
  await expect(review(page)).toBeVisible();
  await expect(page.getByTestId("scan-date")).toHaveText(heading(day(-2)));
  await expect(page.getByTestId("scan-date-source")).toHaveText("Picked by you");
  await expect(page.getByTestId("scan-continue-today")).toBeHidden();
  await review(page).locator("[data-action=apply]").click();
  await expect(review(page)).toHaveCount(0);
  const stored = await page.request.get(`${app.baseUrl}/api/entries?from=${day(-2)}&to=${day(-2)}`);
  expect((await stored.json()).entries.map((e: { title: string }) => e.title)).toEqual(["Alpha", "Zulu"]);
});
