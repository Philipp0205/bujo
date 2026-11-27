import { expect, test, type Page } from "@playwright/test";
import { line } from "../fake-ocr.ts";
import { useBujo, WHATS_NEW_NEWEST } from "./harness.ts";
import { openGallery, openScan } from "./scan-helpers.ts";

const app = useBujo();

// The specs of this file build on each other: the known pages only grow, so each one starts where the last one ended.
test.describe.configure({ mode: "serial" });

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const files = (count: number) => Array.from({ length: count }, (_, index) => ({ name: `page-${index + 1}.png`, mimeType: "image/png", buffer: PNG }));

test.beforeEach(async ({ page }) => {
  await app.signIn(page);
  await page.addInitScript(() => sessionStorage.setItem("ak-install-prompt-dismissed", "1"));
  await page.request.put(`${app.baseUrl}/api/whats-new/seen`, { data: { id: WHATS_NEW_NEWEST } });
  app.ocr.failWith(0);
  app.ocr.delay(0);
  app.ocr.setPage(null);
  app.ocr.setPageNumber(undefined);
});

const review = (page: Page) => page.getByTestId("scan-review");
const banner = (page: Page) => page.getByTestId("gap-reminder");
const hint = (page: Page) => page.getByTestId("scan-gap-hint");

/** One OCR answer: a daily page of its own day (so batches never share a day) with this notebook number. */
const answer = (number: number, dayOfMonth: number) => ({ lines: [line("none", `${dayOfMonth}.11.2026`), line("•", `Line of page ${number}`)], pageNumber: number });

/** Picks one page per answer in the gallery and waits for the first page of the batch. */
async function pick(page: Page, answers: ReturnType<typeof answer>[]): Promise<void> {
  app.ocr.script(answers);
  await page.goto(app.baseUrl);
  await (await openGallery(page)).setFiles(files(answers.length));
  await expect(review(page)).toBeVisible();
}

/** Applies the page on screen, which must carry this notebook number, and waits for the apply to be answered. */
async function applyThis(page: Page, number: number): Promise<void> {
  await expect(page.getByTestId("scan-paper-number")).toHaveValue(String(number));
  await Promise.all([page.waitForResponse((response) => response.url().endsWith("/apply")), review(page).locator("[data-action=apply]").click()]);
}

/** Applies the last page of the scan and waits for the log to read the active notebook after it (where the reminder is worked out). */
async function applyLast(page: Page, number: number): Promise<void> {
  const read = page.waitForResponse((response) => /\/api\/notebooks\/[^/]+$/.test(response.url()) && response.request().method() === "GET");
  await applyThis(page, number);
  await read;
}

test("a single page 3 is the first known page and shows no reminder", async ({ page }) => {
  app.ocr.script([answer(3, 10)]);
  await page.goto(app.baseUrl);
  await (await openScan(page)).setFiles(files(1));
  await expect(review(page)).toBeVisible();
  await applyLast(page, 3);
  await expect(banner(page)).toHaveCount(0);
});

test("a batch of pages 4 and 6 reminds about page 5 once, after the whole batch", async ({ page }) => {
  await pick(page, [answer(4, 11), answer(6, 12)]);
  await expect(hint(page)).toBeHidden();
  await applyThis(page, 4);
  await expect(page.getByTestId("scan-page-of")).toHaveText("Page 2 of 2");
  await expect(banner(page)).toHaveCount(0);
  await expect(hint(page)).toHaveText("This leaves page 5 unscanned.");
  await applyLast(page, 6);
  await expect(banner(page)).toHaveCount(1);
  await expect(page.getByTestId("gap-text")).toHaveText("Page 5 is not scanned yet.");
  await page.getByTestId("gap-dismiss").click();
});

test("a batch applied from the highest page down still reminds once, about the page above the earlier ones", async ({ page }) => {
  await pick(page, [answer(10, 13), answer(8, 14)]);
  await applyThis(page, 10);
  await expect(page.getByTestId("scan-page-of")).toHaveText("Page 2 of 2");
  await expect(banner(page)).toHaveCount(0);
  await applyLast(page, 8);
  await expect(banner(page)).toHaveCount(1);
  await expect(page.getByTestId("gap-text")).toHaveText("Page 9 is not scanned yet.");
  await page.getByTestId("gap-dismiss").click();
});

test("pages of the same batch are not nagged about while they are still to review", async ({ page }) => {
  await pick(page, [answer(14, 15), answer(12, 16), answer(13, 17)]);
  await expect(hint(page)).toBeHidden();
  await applyThis(page, 14);
  await expect(page.getByTestId("scan-page-of")).toHaveText("Page 2 of 3");
  await expect(hint(page)).toBeHidden();
  await applyThis(page, 12);
  await expect(page.getByTestId("scan-page-of")).toHaveText("Page 3 of 3");
  await applyLast(page, 13);
  await expect(banner(page)).toHaveCount(0);
});
