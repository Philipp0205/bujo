import { expect, test, type Page } from "@playwright/test";
import { line } from "../fake-ocr.ts";
import { useBujo, WHATS_NEW_NEWEST } from "./harness.ts";
import { openScan } from "./scan-helpers.ts";

const app = useBujo();

// The specs of this file build on each other: the known pages only grow, so each one starts where the last one ended.
test.describe.configure({ mode: "serial" });

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const photo = { name: "page.png", mimeType: "image/png", buffer: PNG };
const SKIPPED_KEY = "bujo-page-gap-skipped";

test.beforeEach(async ({ page }) => {
  await app.signIn(page);
  await page.addInitScript(() => sessionStorage.setItem("ak-install-prompt-dismissed", "1"));
  await page.request.put(`${app.baseUrl}/api/whats-new/seen`, { data: { id: WHATS_NEW_NEWEST } });
  app.ocr.failWith(0);
  app.ocr.delay(0);
});

const review = (page: Page) => page.getByTestId("scan-review");
const banner = (page: Page) => page.getByTestId("gap-reminder");

/** Scans the daily page 18.11.2026 on physical page `physical`, with this notebook number, and waits for the apply and the read of the active notebook after it. */
async function scanNumber(page: Page, number: number, physical: number): Promise<void> {
  app.ocr.setPage(null);
  app.ocr.setLines([line("none", "18.11.2026"), line("•", `Line of page ${number}`)]);
  app.ocr.setPageNumber(number);
  await page.goto(app.baseUrl);
  await (await openScan(page)).setFiles(photo);
  await expect(review(page)).toBeVisible();
  if (physical > 1) await review(page).locator(`[data-page='${physical}']`).click();
  await expect(page.getByTestId("scan-paper-number")).toHaveValue(String(number));
  const read = page.waitForResponse((response) => /\/api\/notebooks\/[^/]+$/.test(response.url()) && response.request().method() === "GET");
  await review(page).locator("[data-action=apply]").click();
  await expect(review(page)).toHaveCount(0);
  await read;
}

/** The id of the notebook new scans go to. */
async function activeId(page: Page): Promise<string> {
  const list = (await (await page.request.get(`${app.baseUrl}/api/notebooks`)).json()).notebooks as Array<{ id: string; active: boolean }>;
  return list.find((notebook) => notebook.active)!.id;
}

const skipKey = async (page: Page) => `${SKIPPED_KEY}:${await activeId(page)}`;
const storedSkips = async (page: Page) => {
  const key = await skipKey(page);
  return page.evaluate((name) => localStorage.getItem(name), key);
};

test("the first scanned page shows no reminder, even when its number is 5", async ({ page }) => {
  await scanNumber(page, 5, 1);
  await expect(page.locator("#log").getByText("Line of page 5")).toBeVisible();
  await expect(banner(page)).toHaveCount(0);
});

test("the next consecutive page shows no reminder", async ({ page }) => {
  await scanNumber(page, 6, 2);
  await expect(banner(page)).toHaveCount(0);
});

test("a late page names the missing range, and Dismiss closes it without skipping anything", async ({ page }) => {
  await scanNumber(page, 10, 3);
  await expect(banner(page)).toBeVisible();
  await expect(page.getByTestId("gap-text")).toHaveText("Pages 7\u20139 are not scanned yet.");
  await page.getByTestId("gap-dismiss").click();
  await expect(banner(page)).toHaveCount(0);
  expect(await storedSkips(page)).toBeNull();
});

test("a single missing page reads as one page", async ({ page }) => {
  await scanNumber(page, 12, 4);
  await expect(page.getByTestId("gap-text")).toHaveText("Page 11 is not scanned yet.");
  await page.getByTestId("gap-dismiss").click();
});

test("the review hints at the gap a typed number would leave and Apply stays enabled", async ({ page }) => {
  app.ocr.setPage(null);
  app.ocr.setLines([line("none", "18.11.2026"), line("•", "Hint page")]);
  app.ocr.setPageNumber(13);
  await page.goto(app.baseUrl);
  await (await openScan(page)).setFiles(photo);
  await expect(review(page)).toBeVisible();
  await review(page).locator("[data-page='5']").click();
  const hint = page.getByTestId("scan-gap-hint");
  await expect(hint).toBeHidden();
  await page.getByTestId("scan-paper-number").fill("16");
  await expect(hint).toHaveText("This leaves pages 13\u201315 unscanned.");
  await expect(review(page).locator("[data-action=apply]")).toBeEnabled();
  await page.getByTestId("scan-paper-number").fill("13");
  await expect(hint).toBeHidden();
  await page.getByTestId("scan-paper-number").fill("14");
  await expect(hint).toHaveText("This leaves page 13 unscanned.");
});

test("Skip these pages keeps them skipped after a reload and drops them from a later reminder", async ({ page }) => {
  await scanNumber(page, 20, 5);
  await expect(page.getByTestId("gap-text")).toHaveText("Pages 13\u201319 are not scanned yet.");
  await page.getByTestId("gap-skip").click();
  await expect(banner(page)).toHaveCount(0);
  expect(JSON.parse((await storedSkips(page)) ?? "[]")).toEqual([13, 14, 15, 16, 17, 18, 19]);

  await page.reload();
  expect(JSON.parse((await storedSkips(page)) ?? "[]")).toEqual([13, 14, 15, 16, 17, 18, 19]);
  await expect(banner(page)).toHaveCount(0);
});

test("skipped numbers above the frontier are left out of a later jump, the rest are named", async ({ page }) => {
  await page.goto(app.baseUrl);
  const key = await skipKey(page);
  await page.evaluate(([name]) => localStorage.setItem(name, JSON.stringify([21, 22, 24])), [key]);
  await scanNumber(page, 26, 6);
  await expect(page.getByTestId("gap-text")).toHaveText("Pages 23 and 25 are not scanned yet.");
  await page.getByTestId("gap-dismiss").click();
});

test("the old single skip key still counts for the first notebook", async ({ page }) => {
  await page.goto(app.baseUrl);
  const key = await skipKey(page);
  await page.evaluate(([name]) => localStorage.removeItem(name), [key]);
  await page.evaluate((name) => localStorage.setItem(name, JSON.stringify([27, 28])), SKIPPED_KEY);
  await scanNumber(page, 30, 7);
  await expect(page.getByTestId("gap-text")).toHaveText("Page 29 is not scanned yet.");
  await page.getByTestId("gap-dismiss").click();
});

test("a new notebook starts clean: the ended notebook's pages and skips do not count", async ({ page }) => {
  const started = await page.request.post(`${app.baseUrl}/api/notebooks`, { data: { name: "Second", pageCount: 100 } });
  expect(started.status()).toBe(201);
  // The first notebook skipped 13-19 and holds pages up to 30, yet the second one begins at page 1 with no reminder.
  await scanNumber(page, 3, 8);
  await expect(banner(page)).toHaveCount(0);
  await scanNumber(page, 7, 9);
  await expect(page.getByTestId("gap-text")).toHaveText("Pages 4\u20136 are not scanned yet.");
  await page.getByTestId("gap-dismiss").click();
  // The skip of 13-19 in the first notebook does not hide those pages here.
  await scanNumber(page, 20, 10);
  await expect(page.getByTestId("gap-text")).toHaveText("Pages 8\u201319 are not scanned yet.");
  await page.getByTestId("gap-skip").click();
  expect(JSON.parse((await storedSkips(page)) ?? "[]")).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
});
