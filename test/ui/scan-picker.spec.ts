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

const LOG_PAGE = [line("•", "Brot kaufen", 0.9), line("•", "Post abholen", 0.9)];

test.beforeEach(async ({ page }) => {
  await app.signIn(page);
  app.ocr.failWith(0);
  app.ocr.delay(0);
  app.ocr.setPage(null);
});

const review = (page: Page) => page.getByTestId("scan-review");

/** Scans a page and waits for the sheet that guessType picks (the log review for a bullet page). */
async function scan(page: Page, lines: ReturnType<typeof line>[]): Promise<void> {
  app.ocr.setLines(lines);
  await page.goto(app.baseUrl);
  await (await openScan(page)).setFiles(photo);
  await expect(picker(page)).toBeVisible();
}

/** The words of the picker, in order. */
const words = (page: Page) => picker(page).locator(".scan-pick").allTextContents();

test("a log page shows ONE picker with three words, and no other type or page bars", async ({ page }) => {
  await scan(page, LOG_PAGE);
  expect(await words(page)).toEqual(["Log", "Daily", "Page 1"]);
  await expect(picker(page)).toHaveCount(1);
  await expect(review(page).locator(".scan-kinds, .scan-kind-pills, .scan-pagetype")).toHaveCount(0);
  await expect(picker(page).locator(".scan-pick .scan-scribble")).toHaveCount(3);
  await expect(picker(page).locator(".scan-link")).toHaveCount(2);
});

test("Log, Monthly and Log, Future, and Collection each read as their own breadcrumb", async ({ page }) => {
  await scan(page, LOG_PAGE);
  await choose(page, "sub", "Monthly");
  await expect(pickStep(page, "sub")).toHaveAttribute("data-value", "monthly");
  const month = new Date().toLocaleDateString("en-GB", { month: "long" });
  expect(await words(page)).toEqual(["Log", "Monthly", month, "calendar"]);

  await choose(page, "sub", "Future");
  await expect(pickStep(page, "sub")).toHaveAttribute("data-value", "future");
  expect((await words(page)).slice(0, 2)).toEqual(["Log", "Future"]);
  expect((await words(page))[2]).toMatch(/^[A-Z][a-z]{2}( - [A-Z][a-z]{2})?$/);

  await choose(page, "type", "Collection");
  await expect(page.getByTestId("note-sheet")).toBeVisible();
  expect(await words(page)).toEqual(["Collection", "misc"]);
  await expect(picker(page).locator(".scan-link")).toHaveCount(1);
  for (const kind of ["list", "tracker", "project", "misc"]) {
    await choose(page, "sub", kind);
    expect(await words(page)).toEqual(["Collection", kind]);
  }
});

test("a step opens its own popover with 44px choices, and the picked word is selected", async ({ page }) => {
  await scan(page, LOG_PAGE);
  await expect(pickStep(page, "sub")).toHaveAttribute("aria-expanded", "false");
  await pickStep(page, "sub").click();
  await expect(pickStep(page, "sub")).toHaveAttribute("aria-expanded", "true");
  const options = picker(page).getByRole("option");
  await expect(options).toHaveText(["Daily", "Monthly", "Future"]);
  await expect(options.nth(0)).toHaveAttribute("aria-selected", "true");
  for (const height of await options.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height))) {
    expect(height).toBeGreaterThanOrEqual(44);
  }
  await expect(picker(page).locator(".scan-choice .scan-scribble")).toHaveCount(3);
});

test("the popover closes on a pick, on a tap outside and on Escape, and Escape does not close the sheet", async ({ page }) => {
  await scan(page, LOG_PAGE);
  await pickStep(page, "target").click();
  await expect(picker(page).getByRole("listbox")).toBeVisible();
  await picker(page).getByRole("option", { name: "Page 2", exact: true }).click();
  await expect(picker(page).getByRole("listbox")).toHaveCount(0);
  await expect(pickStep(page, "target")).toHaveText("Page 2");

  await pickStep(page, "sub").click();
  await expect(picker(page).getByRole("listbox")).toBeVisible();
  await review(page).locator(".scan-row").first().click({ position: { x: 150, y: 70 } });
  await expect(picker(page).getByRole("listbox")).toHaveCount(0);

  await pickStep(page, "sub").click();
  await page.keyboard.press("Escape");
  await expect(picker(page).getByRole("listbox")).toHaveCount(0);
  await expect(pickStep(page, "sub")).toBeFocused();
  await expect(review(page)).toBeVisible();
});

test("the picker works from the keyboard: arrows move between choices, Enter picks, focus returns to the word", async ({ page }) => {
  await scan(page, LOG_PAGE);
  await pickStep(page, "sub").focus();
  await page.keyboard.press("Enter");
  await expect(picker(page).getByRole("option", { name: "Daily", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(picker(page).getByRole("option", { name: "Monthly", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(pickStep(page, "sub")).toHaveAttribute("data-value", "monthly");
  await expect(pickStep(page, "sub")).toBeFocused();
  await expect(picker(page).getByRole("listbox")).toHaveCount(0);
});

test("editing an entry draws no extra border: no outline or ring on the field or its loop, and the scribble stays", async ({ page }) => {
  await scan(page, LOG_PAGE);
  const row = review(page).locator(".scan-row").first();
  const input = row.locator('[data-field="title"]');
  await page.keyboard.press("Tab");
  await input.focus();
  await page.keyboard.type("x");
  await expect(input).toBeFocused();

  const style = (selector: string) => row.locator(selector).evaluate((node) => {
    const css = getComputedStyle(node);
    return { outline: css.outlineStyle, shadow: css.boxShadow, border: css.borderTopWidth };
  });
  expect(await style('[data-field="title"]')).toEqual({ outline: "none", shadow: "none", border: "0px" });
  expect(await style(".scan-pill")).toEqual({ outline: "none", shadow: "none", border: "0px" });
  await expect(row.locator(".scan-pill .scan-scribble")).toHaveCount(1);
  expect(await row.locator(".scan-pill .scan-scribble path").count()).toBe(2);
});
