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
});

/** A calendar day as YYYY-MM-DD in the local time zone, n days from today. */
function day(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The OCR header line for a day, as it is written on the page: dd.mm.yyyy. */
const headerLine = (iso: string) => line("none", `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`, 0.9);

const review = (page: Page) => page.getByTestId("scan-review");
const rows = (page: Page) => review(page).locator(".scan-row");
const apply = (page: Page) => review(page).locator("[data-action=apply]");
const logRow = (page: Page, title: string) => page.locator(".paper-row", { hasText: title });

/** Makes a fake entry through the API and returns its id. */
async function seed(page: Page, data: { date: string; type: string; title: string }): Promise<string> {
  const response = await page.request.post(`${app.baseUrl}/api/entries`, { data });
  expect(response.status()).toBe(201);
  return (await response.json()).entry.id;
}

/** Sends the photo through the camera chooser; the review sheet is up after this. */
async function scanPage(page: Page, lines: ReturnType<typeof line>[]): Promise<void> {
  app.ocr.setLines(lines);
  await page.goto(app.baseUrl);
  const chooser = await openScan(page);
  await chooser.setFiles(photo);
  await expect(review(page)).toBeVisible();
}

test("a rescan that shows the app's migrated status marks the entry on paper and clears the Not on paper button", async ({ page }) => {
  const id = await seed(page, { date: day(0), type: "task", title: "Zahnarzt anrufen" });
  await scanPage(page, [headerLine(day(0)), line("•", "Zahnarzt anrufen", 0.9)]);
  await apply(page).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.waitForTimeout(10);
  expect((await page.request.patch(`${app.baseUrl}/api/entries/${id}`, { data: { type: "migrated" } })).status()).toBe(200);

  await scanPage(page, [headerLine(day(0)), line(">", "Zahnarzt anrufen", 0.9)]);
  await expect(rows(page).nth(0)).toHaveAttribute("data-status", "unchanged");
  await expect(apply(page)).toBeEnabled();
  await expect(apply(page)).toHaveText("Mark 1 on paper");
  await apply(page).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await expect(page.getByTestId("not-on-paper-open")).toHaveCount(0);
  await expect(logRow(page, "Zahnarzt anrufen")).toHaveCount(1);
  await expect(logRow(page, "Zahnarzt anrufen")).toHaveAttribute("data-type", "migrated");
});

test("a bullet for a task that moved to another day matches its trace, is not ticked and writes nothing", async ({ page }) => {
  const id = await seed(page, { date: day(0), type: "task", title: "Post abholen" });
  expect((await page.request.patch(`${app.baseUrl}/api/entries/${id}`, { data: { date: day(3), trace: "migrated" } })).status()).toBe(200);

  await scanPage(page, [headerLine(day(0)), line("•", "Post abholen", 0.9)]);
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).nth(0).locator('[data-role="note"]')).toContainText("already on paper");
  await expect(rows(page).nth(0)).toHaveAttribute("data-include", "false");
  await expect(apply(page)).toBeDisabled();
});
