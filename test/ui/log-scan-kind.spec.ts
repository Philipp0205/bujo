import { expect, test, type Page } from "@playwright/test";
import { line } from "../fake-ocr.ts";
import { useBujo } from "./harness.ts";
import { choose, openScan, picker, pickStep } from "./scan-helpers.ts";

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
/** How the picker words a month: the name, with the year when it is not this year. */
const monthLabelOf = (offset: number) => (monthAt(offset).getFullYear() === new Date().getFullYear() ? monthName(offset) : `${monthName(offset)} ${monthAt(offset).getFullYear()}`);
const monthKey = (offset: number) => `${monthAt(offset).getFullYear()}-${String(monthAt(offset).getMonth() + 1).padStart(2, "0")}`;

const review = (page: Page) => page.getByTestId("scan-review");
const rows = (page: Page) => review(page).locator(".scan-row");
const apply = (page: Page) => review(page).locator("[data-action=apply]");
/** The page kind the picker shows: its second word ("daily", "monthly" or "future"). */
const kindOf = (page: Page) => pickStep(page, "sub");

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

  await expect(kindOf(page)).toHaveAttribute("data-value", "future");
  await expect(pickStep(page, "target")).toHaveText(`${monthName(2).slice(0, 3)} - ${monthName(3).slice(0, 3)}`);
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

  await expect(kindOf(page)).toHaveAttribute("data-value", "monthly");
  await expect(pickStep(page, "target")).toContainText(monthName(0));
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

  await expect(kindOf(page)).toHaveAttribute("data-value", "monthly");
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

test("the kind can be switched in the picker: the page is read again, the date row gives way to the month, and the picker follows", async ({ page }) => {
  await scanPage(page, [line("•", "Geschenke kaufen", 0.9), line("•", "Steuer", 0.9)]);
  await expect(kindOf(page)).toHaveAttribute("data-value", "daily");
  await expect(pickStep(page, "target")).toHaveText("Page 1");
  await expect(page.getByTestId("scan-date")).toBeVisible();

  await choose(page, "sub", "Monthly");
  await expect(kindOf(page)).toHaveAttribute("data-value", "monthly");
  await expect(pickStep(page, "target")).toContainText(monthName(0));
  await expect(page.getByTestId("scan-date")).toBeHidden();
  await expect(rows(page)).toHaveCount(2);

  await choose(page, "sub", "Daily");
  await expect(kindOf(page)).toHaveAttribute("data-value", "daily");
  await expect(page.getByTestId("scan-date")).toBeVisible();
});

const section = (page: Page, row: number, name: "work" | "private") => rows(page).nth(row).locator(`[data-section="${name}"]`);

test("a tasks page reads its Work and Private headings, a row can move between them, and Apply saves the sections", async ({ page }) => {
  app.ocr.setPage("month-task", monthKey(0));
  await scanPage(page, [
    line("none", monthName(0), 0.9),
    line("none", "Work", 0.9),
    line("•", "Bericht Quartal", 0.9),
    line("none", "Privat", 0.9),
    line("•", "Geschenk Mira", 0.9),
    line("•", "Abgabe Steuer", 0.9),
  ]);
  await expect(pickStep(page, "part")).toHaveText("tasks");
  await expect(rows(page)).toHaveCount(3);
  await expect(section(page, 0, "work")).toHaveAttribute("aria-checked", "true");
  await expect(section(page, 1, "private")).toHaveAttribute("aria-checked", "true");
  await expect(section(page, 1, "work")).toHaveAttribute("aria-checked", "false");
  for (const height of await rows(page).first().locator(".scan-section").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height))) expect(height).toBeGreaterThanOrEqual(44);

  await section(page, 2, "work").click();
  await expect(section(page, 2, "work")).toHaveAttribute("aria-checked", "true");
  await section(page, 0, "private").click();
  await expect(section(page, 0, "private")).toHaveAttribute("aria-checked", "true");
  const style = await section(page, 0, "private").evaluate((node) => {
    const css = getComputedStyle(node);
    return [css.borderTopWidth, css.outlineStyle, css.boxShadow];
  });
  expect(style).toEqual(["0px", "none", "none"]);

  await apply(page).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const last = new Date(monthAt(1).getTime() - 86_400_000);
  const day = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`;
  const stored = (await (await page.request.get(`${app.baseUrl}/api/entries?from=${day}&to=${day}`)).json()).entries;
  const mine = ["Bericht Quartal", "Geschenk Mira", "Abgabe Steuer"];
  expect(stored.filter((entry: { title: string }) => mine.includes(entry.title)).map((entry: { title: string; section: string | null }) => [entry.title, entry.section])).toEqual([
    ["Bericht Quartal", "private"],
    ["Geschenk Mira", "private"],
    ["Abgabe Steuer", "work"],
  ]);
});

test("a monthly page is switched between calendar and tasks in the picker, and each keeps its own rows", async ({ page }) => {
  app.ocr.setPage("month-task", monthKey(0));
  await scanPage(page, [line("none", monthName(0), 0.9), line("•", "Geschenke kaufen", 0.9)]);
  await expect(pickStep(page, "part")).toHaveText("tasks");
  await expect(rows(page).first().locator(".scan-sections")).toBeVisible();

  await choose(page, "part", "calendar");
  await expect(pickStep(page, "part")).toHaveText("calendar");
  await expect(rows(page).first().locator('[data-field="day"]')).toBeVisible();
  await expect(rows(page).first().locator(".scan-sections")).toHaveCount(0);

  await choose(page, "part", "tasks");
  await expect(pickStep(page, "part")).toHaveText("tasks");
  await expect(rows(page).first().locator(".scan-sections")).toBeVisible();
});

test("the target of a monthly page is picked in the picker and Apply files the lines on that month", async ({ page }) => {
  app.ocr.setPage("month-task", monthKey(0));
  await scanPage(page, [line("none", monthName(0), 0.9), line("•", "Geschenke kaufen", 0.9)]);
  await choose(page, "target", monthLabelOf(1));
  await expect(pickStep(page, "target")).toContainText(monthName(1));

  await apply(page).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("month-heading")).toHaveText(new RegExp(`^${monthName(1)}`));
  await expect(page.getByTestId("month-tasks").locator(".paper-row", { hasText: "Geschenke kaufen" })).toHaveCount(1);
});

test("the range of a future page is picked in the picker: the word follows and the picked range is the selected choice", async ({ page }) => {
  app.ocr.setPage("future", null);
  await scanPage(page, [line("none", "Future log", 0.9), line("•", "Irgendwann", 0.9)]);
  await expect(kindOf(page)).toHaveAttribute("data-value", "future");

  await pickStep(page, "target").click();
  const options = picker(page).getByRole("option");
  await expect(options).toHaveCount(4);
  const second = (await options.nth(1).textContent())!;
  await options.nth(1).click();
  await expect(pickStep(page, "target")).toHaveText(second);
  await expect(apply(page)).toBeEnabled();

  await pickStep(page, "target").click();
  await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
});

test("the open view is a prior: a plain page scanned from the Future view reads as a future page", async ({ page }) => {
  await scanPage(page, [line("•", "Irgendwann", 0.9)], "/?view=future");
  await expect(kindOf(page)).toHaveAttribute("data-value", "future");
  await expect(picker(page)).toHaveAttribute("data-source", "bullets");
});

test("the picker and its rows fit a phone, and the last row sits above the Apply dock", async ({ page }) => {
  app.ocr.setPage("future", null);
  const lines = [line("none", monthName(1), 0.9)];
  for (let n = 1; n <= 8; n += 1) lines.push(line("•", `Punkt ${n}`, 0.9));
  await scanPage(page, lines);

  const bar = (await picker(page).boundingBox())!;
  expect(bar.x).toBeGreaterThanOrEqual(0);
  expect(bar.x + bar.width).toBeLessThanOrEqual(390);
  await expect(picker(page).locator(".scan-pick")).toHaveCount(3);
  for (const box of await picker(page).locator(".scan-pick").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height))) {
    expect(box).toBeGreaterThanOrEqual(44);
  }

  await rows(page).last().scrollIntoViewIfNeeded();
  const [last, dock] = [await rows(page).last().boundingBox(), await review(page).locator(".ak-sheet-dock").boundingBox()];
  expect(last!.y + last!.height).toBeLessThanOrEqual(dock!.y + 1);
});
