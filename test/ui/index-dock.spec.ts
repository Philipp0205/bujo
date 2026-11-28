import { expect, test, type Page } from "@playwright/test";
import { line } from "../fake-ocr.ts";
import { openIndexPage, openNotebook, useBujo, WHATS_NEW_NEWEST } from "./harness.ts";
import { mainBar } from "./scan-helpers.ts";

const app = useBujo();

// A 1x1 PNG for the fake OCR and a made-up tiny JPEG for the kept photo. Never a real page photo.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64",
);

test.beforeEach(async ({ page }) => {
  await app.signIn(page);
  await page.addInitScript(() => sessionStorage.setItem("ak-install-prompt-dismissed", "1"));
  await page.request.put(`${app.baseUrl}/api/whats-new/seen`, { data: { id: WHATS_NEW_NEWEST } });
  app.ocr.failWith(0);
  app.ocr.delay(0);
});

const grid = (page: Page) => page.getByTestId("index-grid");
const cell = (page: Page, number: number) => page.getByTestId("index-cell").and(page.locator(`[data-number="${number}"]`));

/** An ISO date this many days from today (the notebook starts today, so its pages are today or later). */
function ahead(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Each seed uses its own two days, so a page of an earlier test never sits on the same day as a later one.
let seeds = 0;

/** Starts a long notebook (so the grid runs under the fold), files two pages in it and keeps a photo for the first. */
async function seedLongNotebook(page: Page): Promise<void> {
  const first = ahead(seeds * 2);
  const second = ahead(seeds * 2 + 1);
  seeds += 1;
  await page.request.post(`${app.baseUrl}/api/notebooks`, { data: { name: "Long", pageCount: 300 } });
  for (const [date, number] of [[first, 9], [second, 10]] as const) {
    app.ocr.setPage(null);
    app.ocr.setLines([line("none", date.split("-").reverse().join(".")), line("•", `Line ${number}`)]);
    const scanned = await page.request.post(`${app.baseUrl}/api/log/scan`, { data: PNG, headers: { "content-type": "image/png" } });
    const draft = (await scanned.json()).draft as { id: string; items: Array<{ id: string; title: string }> };
    const items = draft.items.map((item) => ({ id: item.id, type: "task", title: item.title }));
    await page.request.post(`${app.baseUrl}/api/log/scan/${draft.id}/apply`, { data: { date, paperNumber: number, items } });
  }
  const stored = await page.request.post(`${app.baseUrl}/api/page-photos?kind=day&ref=${first}&page=1`, { data: JPEG, headers: { "content-type": "image/jpeg" } });
  expect(stored.status()).toBe(201);
}

/** The long notebook open on its index subpage, the first cell scrolled to the middle of the screen. */
async function openLong(page: Page): Promise<void> {
  await seedLongNotebook(page);
  await page.goto(`${app.baseUrl}/notes`);
  await openNotebook(page);
  await openIndexPage(page);
  await page.waitForLoadState("networkidle");
  await cell(page, 10).evaluate((el) => el.scrollIntoView({ block: "center" }));
}

/** Asserts the index subpage is back: the list and the notebook view are not, the address is /notes and the index grid is in view. */
async function expectBackAtIndex(page: Page): Promise<void> {
  await expect(page.getByTestId("notebook-index-title")).toBeVisible();
  await expect(page.getByTestId("notebook-title")).toHaveCount(0);
  await expect(page.getByTestId("notebooks-title")).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe("/notes");
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  const height = page.viewportSize()!.height;
  const box = (await grid(page).boundingBox())!;
  expect(box.y).toBeLessThan(height - 100);
  expect(box.y + box.height).toBeGreaterThan(0);
  const tapped = (await cell(page, 10).boundingBox())!;
  expect(tapped.y).toBeGreaterThanOrEqual(0);
  expect(tapped.y + tapped.height).toBeLessThanOrEqual((await mainBar(page).boundingBox())!.y);
}

test("the last index row scrolls fully above the tab bar and the Add button", async ({ page }) => {
  await seedLongNotebook(page);
  await page.goto(`${app.baseUrl}/notes`);
  await openNotebook(page);
  await openIndexPage(page);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const cells = page.getByTestId("index-cell");
  const last = (await cells.last().boundingBox())!;
  const bar = (await mainBar(page).boundingBox())!;
  const add = (await mainBar(page).locator("[data-tab=add]").boundingBox())!;
  expect(last.y + last.height).toBeLessThanOrEqual(bar.y);
  expect(last.y + last.height).toBeLessThanOrEqual(add.y);
});

test("Back from an index cell that opens the log returns to the index subpage, at the grid", async ({ page }) => {
  await openLong(page);
  await cell(page, 10).click();
  await expect(page.getByTestId("notebook-index-title")).toBeHidden({ timeout: 15000 });
  await page.goBack();
  await expectBackAtIndex(page);
});

test("Back from the photo viewer leaves the index subpage as it was, at the grid", async ({ page }) => {
  await openLong(page);
  await cell(page, 9).evaluate((el) => el.scrollIntoView({ block: "start" }));
  await cell(page, 9).click();
  await expect(page.getByTestId("page-photo-view")).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId("page-photo-view")).toHaveCount(0);
  await expectBackAtIndex(page);
});

test("Back from the log after an index page, then Back from the subpage and the notebook, ends on the list", async ({ page }) => {
  await openLong(page);
  await cell(page, 10).click();
  await expect(page.getByTestId("notebook-index-title")).toBeHidden({ timeout: 15000 });
  await page.goBack();
  await expect(page.getByTestId("notebook-index-title")).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId("notebook-title")).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId("notebooks-title")).toBeVisible();
});

test("Back from the log after an index page, then the Notes tab, still shows the list", async ({ page }) => {
  await openLong(page);
  await cell(page, 10).click();
  await expect(page.getByTestId("notebook-index-title")).toBeHidden({ timeout: 15000 });
  await page.goBack();
  await expect(page.getByTestId("notebook-index-title")).toBeVisible();
  await mainBar(page).locator("[data-tab=notes]").click();
  await expect(page.getByTestId("notebooks-title")).toBeVisible();
});
