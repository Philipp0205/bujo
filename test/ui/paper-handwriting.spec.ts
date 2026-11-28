import { expect, test, type Page } from "@playwright/test";
import { line } from "../fake-ocr.ts";
import { pinClock, pinnedDay, useBujo, WHATS_NEW_NEWEST } from "./harness.ts";
import { openScan } from "./scan-helpers.ts";

const app = useBujo();

// A 1x1 PNG. The fake OCR service ignores the pixels and answers the lines the test sets.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const photo = { name: "page.png", mimeType: "image/png", buffer: PNG };

test.beforeEach(async ({ page }) => {
  await pinClock(page);
  await app.signIn(page);
  await page.addInitScript(() => sessionStorage.setItem("ak-install-prompt-dismissed", "1"));
  await page.request.put(`${app.baseUrl}/api/whats-new/seen`, { data: { id: WHATS_NEW_NEWEST } });
  app.ocr.failWith(0);
  app.ocr.delay(0);
});

/** A calendar day as YYYY-MM-DD in the local time zone, n days from today. */
const day = pinnedDay;

/** Every entry around today goes after each test, so each starts from an empty log. */
test.afterEach(async ({ page }) => {
  const response = await page.request.get(`${app.baseUrl}/api/entries?from=${day(-6)}&to=${day(6)}`);
  for (const entry of (await response.json()).entries as Array<{ id: string }>) await page.request.delete(`${app.baseUrl}/api/entries/${entry.id}`);
});

const row = (page: Page, title: string) => page.locator(".paper-row", { hasText: title });
const review = (page: Page) => page.getByTestId("scan-review");

/** Scans a page of today with these bullet lines (and the notebook page number, when given) and applies it. */
async function scanToday(page: Page, titles: string[], number: number | null): Promise<void> {
  const [yyyy, mm, dd] = day(0).split("-");
  app.ocr.setPage(null);
  app.ocr.setLines([line("none", `${dd}.${mm}.${yyyy}`, 0.9), ...titles.map((title) => line("•", title, 0.9))]);
  app.ocr.setPageNumber(number);
  await page.goto(app.baseUrl);
  await (await openScan(page)).setFiles(photo);
  await expect(review(page)).toBeVisible();
  await review(page).locator("[data-action=apply]").click();
  await expect(review(page)).toHaveCount(0);
  await expect(row(page, titles[0])).toBeVisible();
}

async function addAppEntry(page: Page, title: string, offset = 0): Promise<string> {
  const response = await page.request.post(`${app.baseUrl}/api/entries`, { data: { date: day(offset), type: "task", title } });
  expect(response.status()).toBe(201);
  return (await response.json()).entry.id;
}

const fontOf = (page: Page, title: string) => row(page, title).locator(".paper-title").evaluate((el) => getComputedStyle(el).fontFamily);

test("a scanned entry is in the handwriting font and an app entry stays in the serif", async ({ page }) => {
  await addAppEntry(page, "Zeitung holen");
  await scanToday(page, ["Milch kaufen"], null);
  await expect(row(page, "Milch kaufen")).toHaveAttribute("data-origin", "scan");
  await expect(row(page, "Zeitung holen")).toHaveAttribute("data-origin", "app");
  expect(await fontOf(page, "Milch kaufen")).toContain("Caveat");
  expect(await fontOf(page, "Zeitung holen")).not.toContain("Caveat");
});

test("a scanned row is no taller than an app row, and a done scanned entry is struck through", async ({ page }) => {
  await addAppEntry(page, "Zeitung holen");
  await scanToday(page, ["Milch kaufen"], null);
  const scanned = (await row(page, "Milch kaufen").boundingBox())!;
  const typed = (await row(page, "Zeitung holen").boundingBox())!;
  expect(scanned.height).toBe(typed.height);
  const entries = (await (await page.request.get(`${app.baseUrl}/api/entries?from=${day(0)}&to=${day(0)}`)).json()).entries as Array<{ id: string; title: string }>;
  const id = entries.find((entry) => entry.title === "Milch kaufen")!.id;
  await page.request.patch(`${app.baseUrl}/api/entries/${id}`, { data: { type: "done" } });
  await page.reload();
  await expect(row(page, "Milch kaufen")).toHaveAttribute("data-origin", "scan");
  await expect(row(page, "Milch kaufen").locator(".paper-title")).toHaveCSS("text-decoration-line", "line-through");
});

test("changing the title in the app turns a scanned entry into an app entry", async ({ page }) => {
  await scanToday(page, ["Milch kaufen"], null);
  const entries = (await (await page.request.get(`${app.baseUrl}/api/entries?from=${day(0)}&to=${day(0)}`)).json()).entries as Array<{ id: string }>;
  await page.waitForTimeout(20);
  const patched = await page.request.patch(`${app.baseUrl}/api/entries/${entries[0].id}`, { data: { title: "Milch und Brot" } });
  expect(patched.status()).toBe(200);
  await page.reload();
  await expect(row(page, "Milch und Brot")).toHaveAttribute("data-origin", "app");
  expect(await fontOf(page, "Milch und Brot")).not.toContain("Caveat");
});

test("the notebook page number shows in handwriting when known and is hidden when not", async ({ page }) => {
  await scanToday(page, ["Milch kaufen"], 12);
  const number = page.getByTestId("page-number");
  await expect(number).toHaveText("12");
  await expect(number).toHaveAttribute("aria-label", "Notebook page 12");
  expect(await number.evaluate((el) => getComputedStyle(el).fontFamily)).toContain("Caveat");
  await addAppEntry(page, "Gestern", -1);
  await page.goto(`${app.baseUrl}/?day=${day(-1)}`);
  await expect(row(page, "Gestern")).toBeVisible();
  await expect(page.getByTestId("page-number")).toHaveCount(0);
});

/** A swipe with the mouse on the bare paper below the rows, clear of the screen edge. */
async function swipeRight(page: Page): Promise<void> {
  const box = (await page.getByTestId("page-body").boundingBox())!;
  const x = box.x + 60;
  const y = box.y + box.height - 40;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y, { steps: 4 });
  await page.mouse.move(x + 120, y, { steps: 4 });
  await page.mouse.up();
}

test("a day swipe turns the page with the curl animation, and not with reduced motion", async ({ page }) => {
  await addAppEntry(page, "Gestern", -1);
  await addAppEntry(page, "Heute");
  await page.goto(app.baseUrl);
  await expect(row(page, "Heute")).toBeVisible();
  await page.waitForFunction(() => !!document.querySelector(".paper-add"));
  await swipeRight(page);
  const turned = page.locator(".paper-page[data-turn='prev']");
  await expect(turned).toHaveCount(1);
  expect(await turned.evaluate((el) => getComputedStyle(el).animationName)).toBe("page-curl-prev");
  await expect(row(page, "Gestern")).toBeVisible();

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(app.baseUrl);
  await expect(row(page, "Heute")).toBeVisible();
  await page.waitForFunction(() => !!document.querySelector(".paper-add"));
  await swipeRight(page);
  await expect(row(page, "Gestern")).toBeVisible();
  const still = page.locator(".paper-page[data-turn='prev']");
  expect(await still.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
});
