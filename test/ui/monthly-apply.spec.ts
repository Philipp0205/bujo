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
  // The first of November 2026: no day row of the page is before today, and November has 30 days.
  await page.clock.setFixedTime(new Date(2026, 10, 1, 12));
  app.ocr.failWith(0);
  app.ocr.delay(0);
  app.ocr.setPage(null);
});

const review = (page: Page) => page.getByTestId("scan-review");
const rows = (page: Page) => review(page).locator(".scan-row");
const apply = (page: Page) => review(page).locator("[data-action=apply]");
const alert = (page: Page) => review(page).getByRole("alert");

/** Scans a photo from the Month view and waits for the review. */
async function scanFromMonth(page: Page, lines: ReturnType<typeof line>[]): Promise<void> {
  app.ocr.setLines(lines);
  await page.goto(`${app.baseUrl}/?view=month`);
  const chooser = await openScan(page);
  await chooser.setFiles(photo);
  await expect(review(page)).toBeVisible();
}

const heading = () => line("none", "November 2026", 0.9);

/** Three day rows whose titles carry a tag, so each test files its own entries (the entries stay between tests). */
const dayRows = (tag: string) => [
  line("none", `4 Mi Konzert ${tag}`, 0.9),
  line("none", `9 Mo Zahnarzt ${tag}`, 0.9),
  line("none", `20 Fr Kino ${tag}`, 0.9),
];

test("every line with a day applies, and the entries land in the Month view", async ({ page }) => {
  await scanFromMonth(page, [
    heading(),
    ...dayRows("alpha").slice(0, 2),
    line("•", "Sport alpha", 0.9),
    line("none", "30 Mo Umzug alpha", 0.9),
    line("•", "Lesen alpha", 0.9),
  ]);
  await expect(rows(page)).toHaveCount(5);
  await expect(apply(page)).toHaveText("Apply 5 entries");
  await expect(apply(page)).toBeEnabled();
  await expect(alert(page)).toHaveCount(0);
  await apply(page).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".paper-row", { hasText: "Umzug alpha" })).toHaveCount(1);
  await expect(page.locator(".paper-row", { hasText: "Lesen alpha" })).toHaveCount(1);
});

test("a day typed into a kept line enables Apply at once, with no tap elsewhere first", async ({ page }) => {
  await scanFromMonth(page, [heading(), line("•", "Wasser trinken beta", 0.9), ...dayRows("beta")]);
  const habit = rows(page).last();
  await expect(habit).toHaveAttribute("data-include", "false");
  await habit.locator('[data-field="include"]').click();
  await expect(apply(page)).toBeDisabled();
  // fill() types without leaving the field, like a phone's number pad that has no Done key.
  await habit.locator('[data-field="day"]').fill("12");
  await expect(apply(page)).toBeEnabled();
  await expect(alert(page)).toHaveCount(0);
  await apply(page).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".paper-row", { hasText: "Wasser trinken beta" })).toHaveCount(1);
});

test("a day typed into an unticked line keeps it and counts it before the field is left", async ({ page }) => {
  await scanFromMonth(page, [heading(), line("•", "Wasser trinken gamma", 0.9), ...dayRows("gamma")]);
  await expect(apply(page)).toHaveText("Apply 3 entries");
  await rows(page).last().locator('[data-field="day"]').fill("12");
  await expect(apply(page)).toHaveText("Apply 4 entries");
  await expect(rows(page).last()).toHaveAttribute("data-include", "true");
});

test("a kept line with no day is named in the alert, and giving it a day clears it", async ({ page }) => {
  await scanFromMonth(page, [heading(), line("•", "Wasser trinken delta", 0.9), ...dayRows("delta")]);
  await rows(page).last().locator('[data-field="include"]').click();
  await expect(apply(page)).toBeDisabled();
  await expect(alert(page)).toContainText("Wasser trinken delta");
  await expect(alert(page)).toContainText("a day of this month");
  await rows(page).last().locator('[data-field="day"]').fill("12");
  await expect(alert(page)).toHaveCount(0);
  await expect(apply(page)).toBeEnabled();
});

test("a day the month does not have is named in the alert, and fixing it enables Apply", async ({ page }) => {
  await scanFromMonth(page, [heading(), ...dayRows("epsilon"), line("none", "31 Mo Umzug epsilon", 0.9)]);
  await expect(apply(page)).toBeDisabled();
  await expect(alert(page)).toContainText("Umzug epsilon");
  await expect(alert(page)).toContainText("Day 31");
  const umzug = rows(page).last();
  await umzug.locator('[data-field="day"]').fill("30");
  await expect(apply(page)).toBeEnabled();
  await apply(page).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".paper-row", { hasText: "Umzug epsilon" })).toHaveCount(1);
});
