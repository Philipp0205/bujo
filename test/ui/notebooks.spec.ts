import { expect, test, type Page } from "@playwright/test";
import { line } from "../fake-ocr.ts";
import { openIndexPage, openNotebook, useBujo, WHATS_NEW_NEWEST } from "./harness.ts";

const app = useBujo();

// The specs of this file build on each other: the notebooks only grow.
test.describe.configure({ mode: "serial" });

// A 1x1 PNG. The fake OCR service ignores the pixels and answers the lines and the page number the test sets.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test.beforeEach(async ({ page }) => {
  await app.signIn(page);
  await page.addInitScript(() => sessionStorage.setItem("ak-install-prompt-dismissed", "1"));
  await page.request.put(`${app.baseUrl}/api/whats-new/seen`, { data: { id: WHATS_NEW_NEWEST } });
});

const rows = (page: Page) => page.getByTestId("notebook-row");
const cell = (page: Page, number: number) => page.getByTestId("index-cell").and(page.locator(`[data-number="${number}"]`));

/** Scans and applies a fake daily page (through the API, fake OCR) with this number written on it. */
async function scanDay(page: Page, date: string, title: string, number: number): Promise<void> {
  app.ocr.setPage(null);
  app.ocr.setLines([line("none", date.split("-").reverse().join(".")), line("•", title)]);
  app.ocr.setPageNumber(number);
  const scanned = await page.request.post(`${app.baseUrl}/api/log/scan`, { data: PNG, headers: { "content-type": "image/png" } });
  const draft = (await scanned.json()).draft as { id: string; items: Array<{ id: string; title: string }> };
  const items = draft.items.map((item) => ({ id: item.id, type: "task", title: item.title }));
  const applied = await page.request.post(`${app.baseUrl}/api/log/scan/${draft.id}/apply`, { data: { date, paperNumber: number, items } });
  expect(applied.status()).toBe(200);
}

test("the start sheet refuses an empty name and a bad page count and starts nothing", async ({ page }) => {
  await page.goto(`${app.baseUrl}/notes`);
  await expect(rows(page)).toHaveCount(1);
  await page.getByTestId("start-notebook").click();
  await expect(page.getByTestId("notebook-name-input")).toHaveValue("Notebook 2");
  await page.getByTestId("notebook-name-input").fill("  ");
  await page.getByTestId("notebook-save").click();
  await expect(page.getByTestId("notebook-note")).toHaveText("Give the notebook a name.");
  await page.getByTestId("notebook-name-input").fill("Dotted");
  for (const bad of ["0", "1.5", "abc", ""]) {
    await page.getByTestId("notebook-pages-input").fill(bad);
    await page.getByTestId("notebook-save").click();
    await expect(page.getByTestId("notebook-note")).toHaveText("Pages must be a whole number from 1 to 9999.");
  }
  await page.getByTestId("notebook-overlay").click({ position: { x: 4, y: 4 } });
  await expect(page.getByTestId("notebook-sheet")).toHaveCount(0);
  await expect(rows(page)).toHaveCount(1);
});

test("start a new notebook, see both in the list, open one and tap a scanned page of its index", async ({ page }) => {
  await scanDay(page, "2026-11-18", "Alpha", 3);
  await page.request.post(`${app.baseUrl}/api/collections`, { data: { name: "Books", paperPage: 5 } });

  await page.goto(`${app.baseUrl}/notes`);
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first().getByTestId("notebook-name")).toHaveText("Notebook 1");
  await expect(rows(page).first().getByTestId("notebook-active")).toBeVisible();

  await page.getByTestId("start-notebook").click();
  await page.getByTestId("notebook-name-input").fill("Notebook 2");
  await page.getByTestId("notebook-pages-input").fill("40");
  await page.getByTestId("notebook-save").click();
  await expect(page.getByTestId("notebook-sheet")).toHaveCount(0);
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).nth(0).getByTestId("notebook-name")).toHaveText("Notebook 2");
  await expect(rows(page).nth(0).getByTestId("notebook-active")).toBeVisible();
  await expect(rows(page).nth(0).getByTestId("notebook-dates")).toContainText("40 pages");
  await expect(rows(page).nth(1).getByTestId("notebook-active")).toHaveCount(0);
  await expect(rows(page).nth(1).getByTestId("notebook-dates")).toContainText(" to ");

  // A scan after the switch goes to the active notebook.
  await scanDay(page, "2026-11-19", "Bravo", 7);

  await openNotebook(page, "Notebook 1");
  await expect(page.getByTestId("notebook-title")).toHaveText("Notebook 1");
  await expect(page.getByTestId("section-daily").getByTestId("log-row")).toHaveCount(1);
  await expect(page.getByTestId("section-daily")).toContainText("Wed 18.11");
  await expect(page.getByTestId("section-month")).toContainText("Nothing scanned yet.");
  await expect(page.getByTestId("section-collections").getByTestId("collection-row")).toContainText("Books");
  await expect(page.getByTestId("index-cell")).toHaveCount(0);
  await expect(page.getByTestId("notebook-summary")).toContainText("2 of 100 pages scanned");
  await openIndexPage(page);
  await expect(page.getByTestId("index-cell")).toHaveCount(100);
  await expect(page.getByTestId("index-cell").and(page.locator("[data-scanned='1']"))).toHaveCount(2);
  await expect(cell(page, 3)).toHaveAttribute("data-scanned", "1");
  await expect(cell(page, 4)).toHaveAttribute("data-scanned", "0");
  await expect(cell(page, 5)).toHaveAttribute("data-scanned", "1");
  await expect(cell(page, 7)).toHaveAttribute("data-scanned", "0");

  await page.locator("[data-action=index-back]").click();
  await page.locator("[data-action=notebook-back]").click();
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).nth(1).getByTestId("notebook-scanned")).toHaveText("2 of 100 pages scanned");
  await expect(rows(page).nth(0).getByTestId("notebook-scanned")).toHaveText("1 of 40 pages scanned");
  await openNotebook(page, "Notebook 2");
  await openIndexPage(page);
  await expect(page.getByTestId("index-cell")).toHaveCount(40);
  await expect(cell(page, 7)).toHaveAttribute("data-scanned", "1");
  await expect(cell(page, 3)).toHaveAttribute("data-scanned", "0");

  await cell(page, 7).click();
  await expect(page).toHaveURL(/day=2026-11-19/);
  await expect(page.locator("#log").getByText("Bravo")).toBeVisible();
});

const listTitle = (page: Page) => page.getByTestId("notebooks-title");
const detailTitle = (page: Page) => page.getByTestId("notebook-title");
const tab = (page: Page, name: string) => page.getByRole("navigation", { name: "Main" }).locator(`[data-tab=${name.toLowerCase().replace("rapid log", "log")}]`);
const logMain = (page: Page) => page.getByRole("heading", { name: "Daily Log", level: 1 });

/** Waits until no overlay entry is left on top of history (the kit steps back one entry after a layer closes on its own). */
async function layerGone(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => (history.state as { akOverlay?: number } | null)?.akOverlay)).toBeUndefined();
}

test("Back from a notebook shows the list and stays on Notes, the in-page button still works, and a second open behaves the same", async ({ page }) => {
  await page.goto(`${app.baseUrl}/notes`);
  await openNotebook(page);
  await page.goBack();
  await expect(listTitle(page)).toBeVisible();
  await expect(detailTitle(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/notes$/);

  await openNotebook(page);
  await page.locator("[data-action=notebook-back]").click();
  await expect(listTitle(page)).toBeVisible();
  await expect(detailTitle(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/notes$/);

  await openNotebook(page);
  await page.goBack();
  await expect(listTitle(page)).toBeVisible();
  await expect(detailTitle(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/notes$/);
});

test("Back after the in-page button leaves no stale entry: one more Back goes to the log, not a hidden notebook", async ({ page }) => {
  await page.goto(`${app.baseUrl}/`);
  await tab(page, "Notes").click();
  await expect(listTitle(page)).toBeVisible();
  await openNotebook(page);
  await page.locator("[data-action=notebook-back]").click();
  await expect(listTitle(page)).toBeVisible();
  await layerGone(page);
  await page.goBack();
  await expect(logMain(page)).toBeVisible();
  await expect(detailTitle(page)).toHaveCount(0);
});

test("tapping Notes on a notebook shows the list, and Back then goes to the log", async ({ page }) => {
  await page.goto(`${app.baseUrl}/`);
  await tab(page, "Notes").click();
  await openNotebook(page);
  await tab(page, "Notes").click();
  await expect(listTitle(page)).toBeVisible();
  await expect(detailTitle(page)).toHaveCount(0);
  await layerGone(page);
  await page.goBack();
  await expect(logMain(page)).toBeVisible();
  await expect(detailTitle(page)).toHaveCount(0);
});

test("leaving a notebook for the log by the tab bar keeps history short: Notes later opens the list", async ({ page }) => {
  await page.goto(`${app.baseUrl}/`);
  await tab(page, "Notes").click();
  await openNotebook(page);
  await tab(page, "Rapid log").click();
  await expect(logMain(page)).toBeVisible();
  await tab(page, "Notes").click();
  await expect(listTitle(page)).toBeVisible();
  await expect(detailTitle(page)).toHaveCount(0);
  await layerGone(page);
  await page.goBack();
  await expect(logMain(page)).toBeVisible();
});

test("a notebook lists the Index row, then Future, Monthly and Daily logs, then the collections, with no grid at the bottom", async ({ page }) => {
  await page.goto(`${app.baseUrl}/notes`);
  await openNotebook(page);
  const order = await page.locator("#notes [data-testid^=section-]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-testid")));
  expect(order).toEqual(["section-index", "section-future", "section-month", "section-daily", "section-collections"]);
  await expect(page.getByTestId("index-grid")).toHaveCount(0);
  await expect(page.getByTestId("open-page-list")).toHaveCount(0);
  await expect(page.locator(".notes-heading svg.hand-squiggle")).toHaveCount(5);
});

test("the index subpage is a Back layer: Back shows the notebook, then the list; the on-screen link does the same", async ({ page }) => {
  await page.goto(`${app.baseUrl}/notes`);
  await openNotebook(page);
  await openIndexPage(page);
  await expect(detailTitle(page)).toHaveCount(0);
  await page.goBack();
  await expect(detailTitle(page)).toBeVisible();
  await expect(page.getByTestId("index-grid")).toHaveCount(0);
  await page.goBack();
  await expect(listTitle(page)).toBeVisible();
  await expect(page).toHaveURL(/\/notes$/);

  await openNotebook(page);
  await openIndexPage(page);
  await page.locator("[data-action=index-back]").click();
  await expect(detailTitle(page)).toBeVisible();
  await expect(page.getByTestId("index-grid")).toHaveCount(0);
  await page.waitForTimeout(300);
  await page.goBack();
  await expect(listTitle(page)).toBeVisible();
});

test("the page list opened from the index subpage goes Back to the subpage", async ({ page }) => {
  await page.goto(`${app.baseUrl}/notes`);
  await openNotebook(page);
  await openIndexPage(page);
  await page.getByTestId("open-page-list").click();
  await expect(page.getByTestId("index-title")).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId("notebook-index-title")).toBeVisible();
  await expect(page.getByTestId("index-grid")).toBeVisible();
});
