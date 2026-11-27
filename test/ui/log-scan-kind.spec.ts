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
  app.ocr.failWith(0);
  app.ocr.delay(0);
  app.ocr.setPage(null);
});

/** The month n months from now, as a Date on its first day. */
function monthAt(offset: number): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + offset, 1);
}
const monthName = (offset: number) => monthAt(offset).toLocaleDateString("en-GB", { month: "long" });
const monthKey = (offset: number) => `${monthAt(offset).getFullYear()}-${String(monthAt(offset).getMonth() + 1).padStart(2, "0")}`;

const review = (page: Page) => page.getByTestId("scan-review");
const rows = (page: Page) => review(page).locator(".scan-row");
const apply = (page: Page) => review(page).locator("[data-action=apply]");
const pill = (page: Page, kind: string) => review(page).locator(`.scan-kind[data-kind="${kind}"]`);

/** Taps the Scan tab (on a view, if given), sends the photo, and waits for the review. */
async function scanPage(page: Page, lines: ReturnType<typeof line>[], path = "/"): Promise<void> {
  app.ocr.setLines(lines);
  await page.goto(`${app.baseUrl}${path}`);
  const chooser = await openScan(page);
  await chooser.setFiles(photo);
  await expect(review(page)).toBeVisible();
}

test("a future page: the kind is read from the page, rows group under their months, and Apply lands in the Future view", async ({ page }) => {
  app.ocr.setPage("future", null);
  await scanPage(page, [
    line("none", "Future log", 0.9),
    line("none", monthName(2), 0.9),
    line("•", "Urlaub planen", 0.9),
    line("none", monthName(3), 0.9),
    line("•", "Steuer machen", 0.9),
  ]);

  await expect(pill(page, "future")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("scan-kind-source")).toHaveText("Kind read from the page");
  await expect(review(page).locator(".scan-group")).toHaveText([
    new RegExp(`^${monthName(2)}`),
    new RegExp(`^${monthName(3)}`),
  ]);
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).nth(0).locator('[data-field="month"]')).toHaveValue(monthKey(2));
  await expect(page.getByTestId("scan-date")).toBeHidden();
  await expect(page.getByTestId("scan-sub")).toHaveText("Future log \u00b7 2 new entries");
  await expect(rows(page).nth(0).locator('[data-field="type"] option[value="event"]')).toHaveCount(0);

  // A row moved to another month moves under that month's heading.
  await rows(page).nth(1).locator('[data-field="month"]').selectOption(monthKey(2));
  await expect(review(page).locator(".scan-group")).toHaveCount(1);

  await apply(page).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("view-future")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("future-bucket").nth(2).locator(".paper-row", { hasText: "Urlaub planen" })).toHaveCount(1);
  await expect(page.getByTestId("future-bucket").nth(2).locator(".paper-row", { hasText: "Steuer machen" })).toHaveCount(1);
});

test("a month-task page files its lines as month tasks and Apply lands in the Month view", async ({ page }) => {
  app.ocr.setPage("month-task", monthKey(0));
  await scanPage(page, [line("none", monthName(0), 0.9), line("•", "Geschenke kaufen", 0.9), line("•", "Steuer", 0.9)]);

  await expect(pill(page, "month-task")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("scan-month")).toContainText(monthName(0));
  await expect(page.getByTestId("scan-date")).toBeHidden();
  await expect(rows(page)).toHaveCount(2);

  await apply(page).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("view-month")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("month-heading")).toHaveText(new RegExp(`^${monthName(0)}`));
  await expect(page.getByTestId("month-tasks").locator(".paper-row", { hasText: "Geschenke kaufen" })).toHaveAttribute("data-horizon", "month-task");
  await expect(page.getByTestId("month-tasks").locator(".paper-row", { hasText: "Steuer" })).toHaveCount(1);
});

test("a calendar page groups its rows by day, keeps the day editable, and Apply lands in the Month view", async ({ page }) => {
  app.ocr.setPage("calendar", monthKey(1));
  await scanPage(page, [
    line("none", `${monthName(1)} ${monthAt(1).getFullYear()}`, 0.9),
    line("none", "2 Mi Lunch mit Mira", 0.9),
    line("none", "4 Fr Konzert", 0.9),
  ]);

  await expect(pill(page, "calendar")).toHaveAttribute("aria-pressed", "true");
  await expect(review(page).locator(".scan-group")).toHaveCount(2);
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).nth(0).locator('[data-field="day"]')).toHaveValue("2");
  await expect(rows(page).nth(1).locator('[data-field="day"]')).toHaveValue("4");

  // A day that does not exist in the month blocks Apply and says so.
  await rows(page).nth(1).locator('[data-field="day"]').fill("40");
  await rows(page).nth(1).locator('[data-field="day"]').press("Tab");
  await expect(apply(page)).toBeDisabled();
  await expect(review(page).getByRole("alert")).toContainText("day of this month");
  await rows(page).nth(1).locator('[data-field="day"]').fill("5");
  await rows(page).nth(1).locator('[data-field="day"]').press("Tab");
  await expect(apply(page)).toBeEnabled();

  await apply(page).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("view-month")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("month-heading")).toHaveText(new RegExp(`^${monthName(1)}`));
  await expect(page.locator(".paper-row", { hasText: "Lunch mit Mira" })).toHaveCount(1);
  await expect(page.locator(".paper-row", { hasText: "Konzert" })).toHaveCount(1);
});

test("the kind can be switched in the review: the page is read again, the date row gives way to the month row, and the source says picked", async ({ page }) => {
  await scanPage(page, [line("•", "Geschenke kaufen", 0.9), line("•", "Steuer", 0.9)]);
  await expect(pill(page, "daily")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("scan-date")).toBeVisible();

  await pill(page, "month-task").click();
  await expect(pill(page, "month-task")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("scan-kind-source")).toHaveText("Kind picked by you");
  await expect(page.getByTestId("scan-date")).toBeHidden();
  await expect(page.getByTestId("scan-month")).toBeVisible();
  await expect(rows(page)).toHaveCount(2);

  await pill(page, "daily").click();
  await expect(pill(page, "daily")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("scan-date")).toBeVisible();
});

test("the open view is a prior: a plain page scanned from the Future view reads as a future page", async ({ page }) => {
  await scanPage(page, [line("•", "Irgendwann", 0.9)], "/?view=future");
  await expect(pill(page, "future")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("scan-kind-source")).toHaveText("Kind from the open view");
});

test("the kind control and its rows fit a phone, and the last row sits above the Apply dock", async ({ page }) => {
  app.ocr.setPage("future", null);
  const lines = [line("none", monthName(1), 0.9)];
  for (let n = 1; n <= 8; n += 1) lines.push(line("•", `Punkt ${n}`, 0.9));
  await scanPage(page, lines);

  const pills = (await review(page).getByTestId("scan-kinds").boundingBox())!;
  expect(pills.x).toBeGreaterThanOrEqual(0);
  expect(pills.x + pills.width).toBeLessThanOrEqual(390);
  await expect(review(page).locator(".scan-kind[data-kind]")).toHaveCount(4);

  await rows(page).last().scrollIntoViewIfNeeded();
  const [last, dock] = [await rows(page).last().boundingBox(), await review(page).locator(".ak-sheet-dock").boundingBox()];
  expect(last!.y + last!.height).toBeLessThanOrEqual(dock!.y + 1);
});
