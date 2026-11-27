import { expect, test, type Page } from "@playwright/test";
import { line } from "../fake-ocr.ts";
import { useBujo } from "./harness.ts";
import { openGallery, openScan } from "./scan-helpers.ts";

const app = useBujo();

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const files = (count: number) => Array.from({ length: count }, (_, index) => ({ name: `page-${index + 1}.png`, mimeType: "image/png", buffer: PNG }));

const FIRST = [line("•", "Eins Brot", 0.9), line("•", "Eins Post", 0.9)];
const NOTE = [line("none", "Reading list"), line("•", "Dune"), line("•", "Solaris")];
const THIRD = [line("•", "Drei Milch", 0.9), line("•", "Drei Kaffee", 0.9)];

test.beforeEach(async ({ page }) => {
  await app.signIn(page);
  app.ocr.failWith(0);
  app.ocr.delay(0);
  app.ocr.script([]);
  app.ocr.setPage(null);
  app.ocr.setPageNumber(undefined);
});

/** Every entry of the days the tests use goes after each test, so each starts empty. */
test.afterEach(async ({ page }) => {
  for (const entry of await entriesAround(page)) await page.request.delete(`${app.baseUrl}/api/entries/${entry.id}`);
});

/** A calendar day as YYYY-MM-DD in the local time zone, n days from today. */
function day(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

type Stored = { id: string; type: string; title: string };

/** All entries of the days around today, as the API lists them. */
async function entriesAround(page: Page): Promise<Stored[]> {
  const response = await page.request.get(`${app.baseUrl}/api/entries?from=${day(-3)}&to=${day(3)}`);
  return (await response.json()).entries;
}

const review = (page: Page) => page.getByTestId("scan-review");
const noteSheet = (page: Page) => page.getByTestId("note-sheet");
const status = (page: Page) => page.getByTestId("scan-page-status");
const pageOf = (page: Page) => page.getByTestId("scan-page-of");
const dots = (page: Page) => page.locator(".scan-dot");

/** Picks `count` files in the gallery of the camera screen, with the OCR answering the given steps in order. */
async function pick(page: Page, count: number, steps: Array<{ lines?: ReturnType<typeof line>[]; status?: number }>): Promise<void> {
  app.ocr.script(steps);
  await page.goto(app.baseUrl);
  const chooser = await openGallery(page);
  expect(chooser.isMultiple()).toBe(true);
  await chooser.setFiles(files(count));
}

test("three pages from the gallery open on page 1 of 3, and each page is applied, saved or skipped on its own", async ({ page }) => {
  await pick(page, 3, [{ lines: FIRST }, { lines: NOTE }, { lines: THIRD }]);
  await expect(review(page)).toBeVisible();
  await expect(pageOf(page)).toHaveText("Page 1 of 3");
  await expect(dots(page)).toHaveCount(3);

  // Stepping forward and back keeps each page's type and edits.
  await review(page).locator(".scan-row").first().locator('[data-field="title"]').fill("Eins Brot und Butter");
  await page.locator("[data-action=next-page]").click();
  await expect(pageOf(page)).toHaveText("Page 2 of 3");
  await expect(noteSheet(page)).toBeVisible();
  await expect(review(page)).toHaveCount(0);
  await page.locator("[data-action=prev-page]").click();
  await expect(pageOf(page)).toHaveText("Page 1 of 3");
  await expect(review(page).locator(".scan-row").first().locator('[data-field="title"]')).toHaveValue("Eins Brot und Butter");

  // Apply the log page: the others stay open, the note page is next.
  await review(page).locator("[data-action=apply]").click();
  await expect(pageOf(page)).toHaveText("Page 2 of 3");
  await expect(noteSheet(page)).toBeVisible();
  await expect(dots(page).nth(0)).toHaveAttribute("data-status", "applied");
  expect((await entriesAround(page)).map((entry) => entry.title)).toContain("Eins Brot und Butter");

  // Save the note page.
  await noteSheet(page).locator("[data-action=save-note]").click();
  await expect(pageOf(page)).toHaveText("Page 3 of 3");
  await expect(review(page)).toBeVisible();
  await expect(dots(page).nth(1)).toHaveAttribute("data-status", "saved");

  // A page already applied shows no Apply button.
  await page.locator("[data-action=prev-page]").click();
  await page.locator("[data-action=prev-page]").click();
  await expect(status(page)).toBeVisible();
  await expect(page.getByTestId("scan-status-text")).toHaveText("This page is applied to your log.");
  await expect(page.locator("[data-action=apply]")).toHaveCount(0);
  await dots(page).nth(2).click();

  // Skip the last page: the scan is done and nothing of it is saved.
  await page.locator("[data-action=skip-page]").click();
  await expect(page.locator(".ak-sheet-layer")).toHaveCount(0);
  const stored = await entriesAround(page);
  expect(stored.filter((entry) => entry.type === "note")).toHaveLength(1);
  expect(stored.some((entry) => entry.title.startsWith("Drei"))).toBe(false);
  await expect(page.locator("#log").getByText("Eins Brot und Butter")).toBeVisible();
});

test("dismissing the review drops only the pages that were not saved", async ({ page }) => {
  await pick(page, 2, [{ lines: FIRST }, { lines: THIRD }]);
  await expect(pageOf(page)).toHaveText("Page 1 of 2");
  await review(page).locator("[data-action=apply]").click();
  await expect(pageOf(page)).toHaveText("Page 2 of 2");
  await page.keyboard.press("Escape");
  await expect(page.locator(".ak-sheet-layer")).toHaveCount(0);
  const titles = (await entriesAround(page)).map((entry) => entry.title);
  expect(titles).toContain("Eins Brot");
  expect(titles.some((title) => title.startsWith("Drei"))).toBe(false);
  await expect(page.locator("#log").getByText("Eins Brot")).toBeVisible();
});

test("a page that fails to read keeps the other pages and can be tried again", async ({ page }) => {
  app.ocr.setLines(THIRD);
  await pick(page, 3, [{ lines: FIRST }, { status: 500 }, { lines: NOTE }]);
  await expect(pageOf(page)).toHaveText("Page 1 of 3");
  await expect(review(page)).toBeVisible();
  await expect(dots(page).nth(1)).toHaveAttribute("data-status", "failed");

  await page.locator("[data-action=next-page]").click();
  await expect(status(page)).toBeVisible();
  await expect(status(page)).toHaveAttribute("data-status", "failed");
  await expect(page.getByTestId("scan-status-text")).not.toBeEmpty();
  await page.locator("[data-action=prev-page]").click();
  await page.locator("[data-action=next-page]").click();
  await page.locator("[data-action=next-page]").click();
  await expect(noteSheet(page)).toBeVisible();

  await page.locator("[data-action=prev-page]").click();
  await page.locator("[data-action=retry]").click();
  await expect(review(page)).toBeVisible();
  await expect(pageOf(page)).toHaveText("Page 2 of 3");
  await expect(review(page).locator(".scan-row").first().locator('[data-field="title"]')).toHaveValue("Drei Milch");
  await expect(dots(page).nth(1)).toHaveAttribute("data-status", "pending");
});

test("a failed page that fails again shows its message and can be skipped", async ({ page }) => {
  await pick(page, 2, [{ lines: FIRST }, { status: 500 }]);
  await page.locator("[data-action=next-page]").click();
  await expect(status(page)).toBeVisible();
  app.ocr.failWith(500);
  await page.locator("[data-action=retry]").click();
  await expect(page.getByTestId("scan-status-text")).toBeVisible();
  await expect(page.locator("[data-action=retry]")).toBeEnabled();
  await expect(page.getByTestId("scan-page-of")).toHaveText("Page 2 of 2");
  await page.locator("[data-action=skip-page]").click();
  await expect(review(page)).toBeVisible();
  await expect(pageOf(page)).toHaveText("Page 1 of 2");
  await page.locator("[data-action=next-page]").click();
  await expect(status(page)).toHaveAttribute("data-status", "skipped");
  await expect(page.locator("[data-action=retry]")).toBeVisible();
  await expect(page.locator("[data-action=review-again]")).toHaveCount(0);
});

test("more than ten pages are refused with a message and nothing is read", async ({ page }) => {
  const before = app.ocr.requests.length;
  await page.goto(app.baseUrl);
  await openScan(page);
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.locator("[data-action=gallery]").click()]);
  await chooser.setFiles(files(11));
  await expect(page.getByTestId("scan-screen")).toContainText("Pick at most 10 pages at once.");
  expect(app.ocr.requests.length).toBe(before);
});

test("the reading screen says which page of the batch is being read", async ({ page }) => {
  app.ocr.delay(400);
  await pick(page, 2, [{ lines: FIRST }, { lines: THIRD }]);
  await expect(page.getByTestId("scan-step")).toHaveText("Reading page 1 of 2\u2026");
  await expect(page.getByTestId("scan-step")).toHaveText("Reading page 2 of 2\u2026");
  await expect(pageOf(page)).toHaveText("Page 1 of 2");
});

test("one photo from the camera goes straight to the review with no page steps", async ({ page }) => {
  app.ocr.setLines(FIRST);
  await page.goto(app.baseUrl);
  await (await openScan(page)).setFiles(files(1));
  await expect(review(page)).toBeVisible();
  await expect(page.getByTestId("scan-steps")).toHaveCount(0);
  await expect(page.locator("[data-action=skip-page]")).toHaveCount(0);
  await review(page).locator("[data-action=apply]").click();
  await expect(page.locator(".ak-sheet-layer")).toHaveCount(0);
  await expect(page.locator("#log").getByText("Eins Brot")).toBeVisible();
});

test("one gallery photo that fails shows its message on the camera screen", async ({ page }) => {
  await pick(page, 1, [{ status: 500 }]);
  await expect(page.getByTestId("scan-screen")).toBeVisible();
  await expect(page.locator(".scan-slot")).not.toBeEmpty();
  await expect(page.getByTestId("scan-steps")).toHaveCount(0);
});
