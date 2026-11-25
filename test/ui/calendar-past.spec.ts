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

/** The fixed "now" of every test here: Sunday 15 November 2026, noon in the browser's local time. */
const NOW = new Date(2026, 10, 15, 12, 0, 0);

test.beforeEach(async ({ page }) => {
  await app.signIn(page);
  await page.addInitScript(() => sessionStorage.setItem("ak-install-prompt-dismissed", "1"));
  await page.clock.setFixedTime(NOW);
  app.ocr.failWith(0);
  app.ocr.delay(0);
  app.ocr.setPage(null);
});

const review = (page: Page) => page.getByTestId("scan-review");
const rows = (page: Page) => review(page).locator(".scan-row");
const apply = (page: Page) => review(page).locator("[data-action=apply]");
/** The nth row in review order (calendar rows sort by day, future rows by month, others by page position). */
const rowAt = (page: Page, n: number) => rows(page).nth(n);

/** Scans a photo from the given view and waits for the review. */
async function scan(page: Page, lines: ReturnType<typeof line>[], path: string): Promise<void> {
  app.ocr.setLines(lines);
  await page.goto(`${app.baseUrl}${path}`);
  const chooser = await openScan(page);
  await chooser.setFiles(photo);
  await expect(review(page)).toBeVisible();
}

const calendar = (page: Page, lines: ReturnType<typeof line>[]) => {
  app.ocr.setPage("calendar", "2026-11");
  return scan(page, [line("none", "November 2026", 0.9), ...lines], "/?view=month");
};

test("a calendar line before today starts unticked with a past mark; today and later stay ticked", async ({ page }) => {
  await calendar(page, [
    line("none", "3 Di Zahnarzt", 0.9),
    line("none", "15 So Brunch", 0.9),
    line("none", "20 Fr Konzert", 0.9),
  ]);
  const past = rowAt(page, 0);
  await expect(past).toHaveAttribute("data-include", "false");
  await expect(past.getByTestId("scan-past")).toBeVisible();
  await expect(past.getByTestId("scan-past")).toHaveText("past");
  await expect(past.getByTestId("scan-past")).toHaveAttribute("aria-label", /unticked/);
  for (const n of [1, 2]) {
    await expect(rowAt(page, n)).toHaveAttribute("data-include", "true");
    await expect(rowAt(page, n).getByTestId("scan-past")).toBeHidden();
  }
  await expect(apply(page)).toHaveText("Apply 2 entries");
});

test("a past calendar line ticked by hand is applied", async ({ page }) => {
  await calendar(page, [line("none", "3 Di Zahnarzt", 0.9), line("none", "20 Fr Konzert", 0.9)]);
  await rowAt(page, 0).locator('[data-field="include"]').click();
  await expect(rowAt(page, 0)).toHaveAttribute("data-include", "true");
  await expect(apply(page)).toHaveText("Apply 2 entries");
  await apply(page).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".paper-row", { hasText: "Zahnarzt" })).toHaveCount(1);
  await expect(page.locator(".paper-row", { hasText: "Konzert" })).toHaveCount(1);
});

test("a calendar line with no day stays unticked and has no past mark", async ({ page }) => {
  await calendar(page, [line("•", "Steuer machen", 0.9), line("none", "16 Mo Lunch", 0.9), line("none", "18 Mi Konzert", 0.9), line("none", "20 Fr Kino", 0.9)]);
  // Rows with no day sort last.
  const dayless = rowAt(page, 3);
  await expect(dayless.locator('[data-field="title"]')).toHaveValue("Steuer machen");
  await expect(dayless).toHaveAttribute("data-include", "false");
  await expect(dayless.getByTestId("scan-past")).toBeHidden();
  await expect(apply(page)).toHaveText("Apply 3 entries");
});

test("giving a past line a later day ticks it again", async ({ page }) => {
  await calendar(page, [line("none", "3 Di Friseur", 0.9), line("none", "20 Fr Theater", 0.9)]);
  const past = rowAt(page, 0);
  await past.locator('[data-field="day"]').fill("25");
  await past.locator('[data-field="day"]').press("Tab");
  await expect(past).toHaveAttribute("data-include", "true");
  await expect(past.getByTestId("scan-past")).toBeHidden();
});

test("a future page: a line in an earlier month starts unticked, this month and later stay ticked", async ({ page }) => {
  app.ocr.setPage("future", null);
  await scan(page, [
    line("none", "Future log", 0.9),
    line("none", "October 2026", 0.9),
    line("•", "Alt", 0.9),
    line("none", "November 2026", 0.9),
    line("•", "Jetzt", 0.9),
    line("none", "December 2026", 0.9),
    line("•", "Bald", 0.9),
  ], "/?view=future");
  await expect(rowAt(page, 0)).toHaveAttribute("data-include", "false");
  await expect(rowAt(page, 0).getByTestId("scan-past")).toBeVisible();
  for (const n of [1, 2]) {
    await expect(rowAt(page, n)).toHaveAttribute("data-include", "true");
    await expect(rowAt(page, n).getByTestId("scan-past")).toBeHidden();
  }
});

test("a daily page is unchanged: lines of an earlier day start ticked with no past mark", async ({ page }) => {
  app.ocr.setPage("daily", "2026-11-03");
  await scan(page, [line("none", "Tuesday 03.11", 0.9), line("•", "Alt erledigen", 0.9), line("○", "Termin", 0.9)], "/");
  await expect(rows(page)).toHaveCount(2);
  for (const n of [0, 1]) {
    await expect(rowAt(page, n)).toHaveAttribute("data-include", "true");
    await expect(rowAt(page, n).getByTestId("scan-past")).toBeHidden();
  }
});
