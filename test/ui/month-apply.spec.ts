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
  // The first of the month, so no day row of the page is before today (past lines start unticked).
  const now = new Date();
  await page.clock.setFixedTime(new Date(now.getFullYear(), now.getMonth(), 1, 12));
  app.ocr.failWith(0);
  app.ocr.delay(0);
  app.ocr.setPage(null);
});

const thisMonth = () => new Date().toLocaleDateString("en-GB", { month: "long" });
const review = (page: Page) => page.getByTestId("scan-review");
const rows = (page: Page) => review(page).locator(".scan-row");
const apply = (page: Page) => review(page).locator("[data-action=apply]");

/** Scans a photo from the Month view and waits for the review. */
async function scanFromMonth(page: Page, lines: ReturnType<typeof line>[]): Promise<void> {
  app.ocr.setLines(lines);
  await page.goto(`${app.baseUrl}/?view=month`);
  const chooser = await openScan(page);
  await chooser.setFiles(photo);
  await expect(review(page)).toBeVisible();
}

/** Asserts Apply is enabled and really receives the tap: it is on screen, has size, and is the element at its own centre. */
async function expectPressable(page: Page): Promise<void> {
  await expect(apply(page)).toBeEnabled();
  await expect.poll(async () => { const b = (await apply(page).boundingBox())!; return b.y + b.height; }).toBeLessThanOrEqual(844);
  const box = (await apply(page).boundingBox())!;
  expect(box.width).toBeGreaterThan(40);
  expect(box.height).toBeGreaterThan(30);
  expect(box.y + box.height).toBeLessThanOrEqual(844);
  const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("[data-action=apply]") !== null, [box.x + box.width / 2, box.y + box.height / 2]);
  expect(hit).toBe(true);
}

test("a monthly log with a task above its first day row can be applied from the Month view", async ({ page }) => {
  await scanFromMonth(page, [
    line("none", thisMonth(), 0.9),
    line("•", "Steuer machen", 0.9),
    line("none", "2 Mi Lunch mit Mira", 0.9),
    line("none", "4 Fr Konzert", 0.9),
    line("none", "9 Mi Zahnarzt", 0.9),
  ]);
  await expect(rows(page)).toHaveCount(4);
  // The task has no day, so it starts unticked and does not block Apply for the three day rows.
  await expect(rows(page).last()).toHaveAttribute("data-include", "false");
  await expect(apply(page)).toHaveText("Apply 3 entries");
  await expectPressable(page);

  await apply(page).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("view-month")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".paper-row", { hasText: "Steuer machen" })).toHaveCount(0);
  await expect(page.locator(".paper-row", { hasText: "Konzert" })).toHaveCount(1);
});

test("a day-less line ticked by hand blocks Apply until it has a day", async ({ page }) => {
  await scanFromMonth(page, [
    line("none", thisMonth(), 0.9),
    line("•", "Steuer machen", 0.9),
    line("none", "2 Mi Lunch mit Mira", 0.9),
    line("none", "4 Fr Konzert", 0.9),
    line("none", "9 Mi Zahnarzt", 0.9),
  ]);
  // Rows with no day sort last.
  const dayless = rows(page).last();
  await dayless.locator('[data-field="include"]').click();
  await expect(apply(page)).toBeDisabled();
  await dayless.locator('[data-field="day"]').fill("12");
  await dayless.locator('[data-field="day"]').press("Tab");
  await expectPressable(page);
  await apply(page).click();
  await expect(page.locator(".paper-row", { hasText: "Steuer machen" })).toHaveCount(1);
});

test("a monthly task page scanned from the Month view can be applied", async ({ page }) => {
  await scanFromMonth(page, [line("none", thisMonth(), 0.9), line("•", "Geschenke kaufen", 0.9), line("•", "Steuer", 0.9)]);
  await expectPressable(page);
  await apply(page).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("month-tasks").locator(".paper-row", { hasText: "Geschenke kaufen" })).toHaveCount(1);
});
