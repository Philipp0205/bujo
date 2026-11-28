import { expect, test, type Page } from "@playwright/test";
import { line } from "../fake-ocr.ts";
import { gotoNotebook, useBujo, WHATS_NEW_NEWEST } from "./harness.ts";
import { choose, openScan, pickStep } from "./scan-helpers.ts";

const app = useBujo();

// The specs of this file build on each other: the index only grows, so each one checks the whole list it expects.
test.describe.configure({ mode: "serial" });

// A 1x1 PNG. The fake OCR service ignores the pixels and answers the lines and the page number the test sets.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const photo = { name: "page.png", mimeType: "image/png", buffer: PNG };

test.beforeEach(async ({ page }) => {
  await app.signIn(page);
  await page.addInitScript(() => sessionStorage.setItem("ak-install-prompt-dismissed", "1"));
  await page.request.put(`${app.baseUrl}/api/whats-new/seen`, { data: { id: WHATS_NEW_NEWEST } });
  app.ocr.failWith(0);
  app.ocr.delay(0);
});

const review = (page: Page) => page.getByTestId("scan-review");
const field = (page: Page) => page.getByTestId("scan-paper-number");
const note = (page: Page) => page.getByTestId("scan-paper-note");

/** The daily page of Wednesday 18.11.2026 with these bullet lines, as the fake OCR reads it with this page number. */
function readDay(titles: string[], number: number | null | undefined): void {
  app.ocr.setPage(null);
  app.ocr.setLines([line("none", "18.11.2026"), ...titles.map((title) => line("•", title))]);
  app.ocr.setPageNumber(number);
}

/** Opens the review of the photo the fake OCR is set to read. */
async function scanPhoto(page: Page): Promise<void> {
  await page.goto(app.baseUrl);
  await (await openScan(page)).setFiles(photo);
  await expect(review(page)).toBeVisible();
}

/** Applies the open review and waits for its sheet to close. */
async function applyReview(page: Page): Promise<void> {
  await review(page).locator("[data-action=apply]").click();
  await expect(review(page)).toHaveCount(0);
}

/** The index as [number, label] rows, top to bottom, read on the page list of the active notebook. */
async function indexRows(page: Page): Promise<string[][]> {
  await gotoNotebook(page, app.baseUrl);
  await page.getByTestId("open-index").click();
  await expect(page.getByTestId("index-title")).toBeVisible();
  await expect(page.getByTestId("index-list").or(page.locator("[data-state=empty]"))).toBeVisible();
  const numbers = await page.getByTestId("index-number").allTextContents();
  const labels = await page.getByTestId("index-label").allTextContents();
  return numbers.map((number, at) => [number, labels[at]]);
}

test("a daily scan shows the page number the OCR read with its hint; the corrected number is what the index lists", async ({ page }) => {
  readDay(["Alpha", "Bravo"], 12);
  await scanPhoto(page);
  await expect(field(page)).toHaveValue("12");
  await expect(note(page)).toHaveText("read from the photo");

  await field(page).fill("14");
  await expect(note(page)).toBeHidden();
  await expect(review(page).locator("[data-action=apply]")).toBeEnabled();
  await applyReview(page);

  expect(await indexRows(page)).toEqual([["p. 14", "Wed 18.11"]]);
});

test("page 2 of the same day, picked with the page picker, has its own number", async ({ page }) => {
  readDay(["Charlie"], 15);
  await scanPhoto(page);
  await choose(page, "target", "Page 2");
  await expect(pickStep(page, "target")).toHaveText("Page 2");
  await expect(field(page)).toHaveValue("15");
  await applyReview(page);

  expect(await indexRows(page)).toEqual([["p. 14", "Wed 18.11"], ["p. 15", "Wed 18.11, page 2"]]);
});

test("a monthly log and a future log are listed in number order, with a collection's page number between them", async ({ page }) => {
  await page.request.post(`${app.baseUrl}/api/collections`, { data: { name: "Books", paperPage: 17 } });

  app.ocr.setPage("month-task", "2027-03");
  app.ocr.setLines([line("•", "Geschenke kaufen")]);
  app.ocr.setPageNumber(20);
  await scanPhoto(page);
  await expect(field(page)).toHaveValue("20");
  await applyReview(page);

  app.ocr.setPage("future", "2027");
  app.ocr.setLines([line("none", "Future log 2027"), line("none", "April"), line("•", "Urlaub buchen"), line("none", "Juli"), line("•", "Steuer machen")]);
  app.ocr.setPageNumber(30);
  await scanPhoto(page);
  await expect(field(page)).toHaveValue("30");
  await applyReview(page);

  expect(await indexRows(page)).toEqual([
    ["p. 14", "Wed 18.11"],
    ["p. 15", "Wed 18.11, page 2"],
    ["p. 17", "Books"],
    ["p. 20", "March 2027"],
    ["p. 30", "Future log, from Apr 2027"],
  ]);
  await expect(page.getByTestId("open-index")).toHaveCount(0);
});

test("the notebook has a Notebook index entry with the count of pages", async ({ page }) => {
  await gotoNotebook(page, app.baseUrl);
  await expect(page.getByTestId("open-index")).toContainText("Notebook index");
  await expect(page.getByTestId("index-count")).toHaveText("5 pages");
});

test("tapping an index row opens the day, the month log and the collection page", async ({ page }) => {
  await gotoNotebook(page, app.baseUrl);
  const open = async (label: string) => {
    await page.getByTestId("open-index").click();
    await page.getByTestId("index-row").filter({ hasText: label }).click();
  };

  await open("Wed 18.11, page 2");
  await expect(page).toHaveURL(/day=2026-11-18/);
  await expect(page.locator("#log").getByText("Alpha")).toBeVisible();

  await gotoNotebook(page, app.baseUrl);
  await open("March 2027");
  await expect(page).toHaveURL(/view=month/);
  await expect(page).toHaveURL(/month=2027-03/);

  await gotoNotebook(page, app.baseUrl);
  await open("Future log, from Apr 2027");
  await expect(page).toHaveURL(/view=future/);

  await gotoNotebook(page, app.baseUrl);
  await open("Books");
  await expect(page.getByTestId("collection-title")).toHaveText("Books");
  await expect(page.getByTestId("collection-page-mark")).toHaveText("p. 17");
});

test("a scan without a number has an empty field, applies, and adds nothing to the index", async ({ page }) => {
  readDay(["Delta"], undefined);
  await scanPhoto(page);
  await expect(field(page)).toHaveValue("");
  await expect(note(page)).toBeHidden();
  await choose(page, "target", "Page 3");
  await applyReview(page);
  await expect(page.locator("#log").getByText("Delta")).toBeVisible();

  const rows = await indexRows(page);
  expect(rows).toHaveLength(5);
  expect(rows.map((row) => row[0])).toEqual(["p. 14", "p. 15", "p. 17", "p. 20", "p. 30"]);
});

test("an invalid number blocks Apply and says why; fixing or emptying it brings Apply back", async ({ page }) => {
  readDay(["Echo"], 40);
  await scanPhoto(page);
  const apply = review(page).locator("[data-action=apply]");
  await choose(page, "target", "Page 4");
  await expect(apply).toBeEnabled();

  for (const bad of ["0", "10000", "abc", "1.5"]) {
    await field(page).fill(bad);
    await expect(apply).toBeDisabled();
    await expect(note(page)).toHaveText("The notebook page must be a whole number from 1 to 9999, or empty.");
  }
  await field(page).fill("");
  await expect(apply).toBeEnabled();
  await expect(note(page)).toBeHidden();
  await field(page).fill("41");
  await applyReview(page);

  const rows = await indexRows(page);
  expect(rows.map((row) => row[0])).toEqual(["p. 14", "p. 15", "p. 17", "p. 20", "p. 30", "p. 41"]);
  expect(rows[5][1]).toBe("Wed 18.11, page 4");
});
