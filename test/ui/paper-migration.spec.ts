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
  app.ocr.failWith(0);
  app.ocr.delay(0);
  await page.addInitScript(() => sessionStorage.setItem("ak-install-prompt-dismissed", "1"));
  await page.request.put(`${app.baseUrl}/api/whats-new/seen`, { data: { id: WHATS_NEW_NEWEST } });
});

/** A calendar day as YYYY-MM-DD in the local time zone, n days from today (the page uses the local day too). */
const day = pinnedDay;

/** The OCR header line for a day, as it is written on the page: dd.mm.yyyy. */
const headerLine = (iso: string) => line("none", `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`, 0.9);

/** Every test starts from an empty log: all entries of the throwaway account go. */
test.afterEach(async ({ page }) => {
  const response = await page.request.get(`${app.baseUrl}/api/entries?from=${day(-40)}&to=${day(5)}`);
  for (const entry of (await response.json()).entries as Array<{ id: string }>) await page.request.delete(`${app.baseUrl}/api/entries/${entry.id}`);
});

async function seed(page: Page, date: string, title: string): Promise<void> {
  expect((await page.request.post(`${app.baseUrl}/api/entries`, { data: { date, type: "task", title } })).status()).toBe(201);
}

const review = (page: Page) => page.getByTestId("scan-review");
const rows = (page: Page) => review(page).locator(".scan-row");
const apply = (page: Page) => review(page).locator("[data-action=apply]");

/** Scans a photo of today's page that carries "Post abholen" over from an earlier day. The review is up after this. */
async function scanCarryPage(page: Page): Promise<void> {
  await seed(page, day(-5), "Post abholen");
  await seed(page, day(-5), "Brot kaufen");
  app.ocr.setLines([headerLine(day(0)), line("•", "Post abholen", 0.9)]);
  await page.goto(app.baseUrl);
  const chooser = await openScan(page);
  await chooser.setFiles(photo);
  await expect(review(page)).toBeVisible();
}

test("a line that carries an open task of an earlier day says where it moved from, and Not the same undoes it", async ({ page }) => {
  await scanCarryPage(page);
  const first = rows(page).nth(0);
  const note = first.locator('[data-role="note"]');
  const unmatch = first.locator('[data-field="unmatch"]');
  const from = new Date(`${day(-5)}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

  await expect(first).toHaveAttribute("data-match", "matched");
  await expect(note).toHaveText(`matches, moved from ${from}`);
  await expect(apply(page)).toHaveText("Apply 1 update");

  await unmatch.click();
  await expect(first).toHaveAttribute("data-match", "unmatched");
  await expect(apply(page)).toHaveText("Apply 1 entry");
  await unmatch.click();
  await expect(note).toHaveText(`matches, moved from ${from}`);
});

test("after the later page is applied the migration review no longer asks about the carried task, only the other one", async ({ page }) => {
  await scanCarryPage(page);
  await apply(page).click();
  await expect(review(page)).toHaveCount(0);

  await page.goto(app.baseUrl);
  await page.waitForFunction(() => !!document.querySelector(".paper-add"));
  await page.getByTestId("migrate-open").click();
  await expect(page.getByTestId("migrate-review")).toBeVisible();
  await expect(page.getByTestId("migrate-sub")).toHaveText("Task 1 of 1");
  await expect(page.getByTestId("migrate-item")).toHaveText("Brot kaufen");
});
