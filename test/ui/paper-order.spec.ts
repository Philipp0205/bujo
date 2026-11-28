import { expect, test, type Page } from "@playwright/test";
import { line } from "../fake-ocr.ts";
import { useBujo } from "./harness.ts";
import { openScan, pickStep } from "./scan-helpers.ts";

const app = useBujo();

// A 1x1 PNG. The fake OCR service ignores the pixels and answers the lines the test sets.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const photo = { name: "page.png", mimeType: "image/png", buffer: PNG };

test.beforeEach(async ({ page }) => {
  await app.signIn(page);
  await page.addInitScript(() => sessionStorage.setItem("ak-install-prompt-dismissed", "1"));
  app.ocr.failWith(0);
  app.ocr.delay(0);
});

/** Today as YYYY-MM-DD in the local time zone (the page uses the local day too). */
function today(): string {
  const date = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Every entry of today goes after each test, so each starts from an empty day. */
test.afterEach(async ({ page }) => {
  const day = today();
  const { entries } = await (await page.request.get(`${app.baseUrl}/api/entries?from=${day}&to=${day}`)).json();
  for (const entry of entries) await page.request.delete(`${app.baseUrl}/api/entries/${entry.id}`);
});

const headerLine = () => line("none", `${today().slice(8, 10)}.${today().slice(5, 7)}.${today().slice(0, 4)}`, 0.9);
const titles = (page: Page) => page.locator(".paper-row:not(.paper-trace) .paper-title");
const review = (page: Page) => page.getByTestId("scan-review");

/** Scans a page of bullet lines through the Scan tab, ticks nothing by hand and applies. The log is up on the day after this. */
async function scanAndApply(page: Page, bullets: string[]): Promise<void> {
  app.ocr.setLines([headerLine(), ...bullets.map((text) => line("•", text, 0.9))]);
  await page.goto(app.baseUrl);
  const chooser = await openScan(page);
  await chooser.setFiles(photo);
  await expect(review(page)).toBeVisible();
  await review(page).locator("[data-action=apply]").click();
  await expect(review(page)).toHaveCount(0);
  await expect(titles(page).first()).toBeVisible();
}

test("the daily log shows the paper order, with an entry written in the app after every paper line", async ({ page }) => {
  expect((await page.request.post(`${app.baseUrl}/api/entries`, { data: { date: today(), type: "task", title: "Zeitung holen" } })).status()).toBe(201);
  await scanAndApply(page, ["Alpha", "Bravo", "Charlie"]);
  await expect(titles(page)).toHaveText(["Alpha", "Bravo", "Charlie", "Zeitung holen"]);
  await expect(page.locator(".paper-row", { hasText: "Zeitung holen" })).toHaveAttribute("data-on-paper", "false");
  await expect(page.getByTestId("page-break")).toHaveCount(0);
});

test("page 2 of a long day continues it: a quiet page break shows where it starts, and page 1 is kept", async ({ page }) => {
  await scanAndApply(page, ["Alpha", "Bravo"]);
  await page.request.post(`${app.baseUrl}/api/entries`, { data: { date: today(), type: "task", title: "Zeitung holen" } });

  app.ocr.setLines([headerLine(), line("•", "Charlie", 0.9), line("•", "Delta", 0.9)]);
  await page.goto(app.baseUrl);
  await (await openScan(page)).setFiles(photo);
  await expect(review(page)).toBeVisible();
  await expect(page.getByTestId("scan-picker")).toBeVisible();
  await expect(pickStep(page, "target")).toHaveText("Page 2");
  await review(page).locator("[data-action=apply]").click();
  await expect(review(page)).toHaveCount(0);

  await expect(titles(page)).toHaveText(["Alpha", "Bravo", "Charlie", "Delta", "Zeitung holen"]);
  const pageBreak = page.getByTestId("page-break");
  await expect(pageBreak).toHaveCount(1);
  await expect(pageBreak).toHaveText("Page 2");
  await expect(pageBreak).toHaveCSS("pointer-events", "none");

  const [above, rule, below] = await Promise.all([
    page.locator(".paper-row", { hasText: "Bravo" }).boundingBox(),
    pageBreak.boundingBox(),
    page.locator(".paper-row", { hasText: "Charlie" }).boundingBox(),
  ]);
  expect(rule!.y).toBeGreaterThanOrEqual(above!.y + above!.height - 1);
  expect(rule!.y + rule!.height).toBeLessThanOrEqual(below!.y + 1);
  expect(rule!.x).toBeGreaterThanOrEqual(24);
});

test("a rescan of page 1 is the suggested page, does not wipe page 2 and files a new line in place", async ({ page }) => {
  await scanAndApply(page, ["Alpha", "Bravo"]);
  await scanAndApply(page, ["Charlie", "Delta"]);
  await expect(titles(page)).toHaveText(["Alpha", "Bravo", "Charlie", "Delta"]);

  app.ocr.setLines([headerLine(), line("•", "Alpha", 0.9), line("•", "Zulu", 0.9), line("•", "Bravo", 0.9)]);
  await page.goto(app.baseUrl);
  await (await openScan(page)).setFiles(photo);
  await expect(review(page)).toBeVisible();
  await expect(pickStep(page, "target")).toHaveText("Page 1");
  await expect(page.getByTestId("scan-page-note")).toContainText("Rescan of page 1");
  await review(page).locator("[data-action=apply]").click();
  await expect(review(page)).toHaveCount(0);

  await expect(titles(page)).toHaveText(["Alpha", "Zulu", "Bravo", "Charlie", "Delta"]);
  await expect(page.getByTestId("page-break")).toHaveCount(1);
});
