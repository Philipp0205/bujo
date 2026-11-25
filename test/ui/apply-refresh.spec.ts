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
const review = (page: Page) => page.getByTestId("scan-review");

/**
 * Holds the first list read (the pre-apply list, already fetched) and lets every later one through.
 * release() answers the held read with that old body, as a slow read that finishes late would.
 */
async function holdFirstRead(page: Page) {
  let seen = 0;
  let release: () => Promise<void> = async () => {};
  await page.route(/\/api\/entries\?.*traces=1/, async (route) => {
    seen += 1;
    if (seen > 1) return route.continue();
    const stale = await route.fetch();
    const body = await stale.body();
    release = () => route.fulfill({ response: stale, body });
  });
  return {
    reads: () => seen,
    release: () => release(),
  };
}

/** Scans from the daily log, applies, and answers the held pre-apply read only after the post-apply reload has started. */
async function applyThenReleaseStale(page: Page, lines: ReturnType<typeof line>[]): Promise<void> {
  const held = await holdFirstRead(page);
  app.ocr.setLines([headerLine(), ...lines]);
  await page.goto(app.baseUrl);
  await expect.poll(() => held.reads()).toBe(1);
  await (await openScan(page)).setFiles(photo);
  await expect(review(page)).toBeVisible();
  await review(page).locator("[data-action=apply]").click();
  await expect(review(page)).toHaveCount(0);
  await expect.poll(() => held.reads()).toBeGreaterThanOrEqual(2);
  await held.release();
}

test("a late list read from before Apply does not wipe the new entry from the daily log", async ({ page }) => {
  await applyThenReleaseStale(page, [line("•", "Frisch gescannt", 0.9)]);
  await page.waitForTimeout(500);
  await expect(page.locator(".paper-row:not(.paper-trace) .paper-title", { hasText: "Frisch gescannt" })).toBeVisible();
});

test("a late list read from before Apply does not bring back the old type of an updated entry", async ({ page }) => {
  const made = await page.request.post(`${app.baseUrl}/api/entries`, { data: { date: today(), type: "task", title: "Wasser holen" } });
  expect(made.status()).toBe(201);
  await applyThenReleaseStale(page, [line("x", "Wasser holen", 0.9)]);
  await page.waitForTimeout(500);
  const row = page.locator(".paper-row", { hasText: "Wasser holen" });
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute("data-type", "done");
});
