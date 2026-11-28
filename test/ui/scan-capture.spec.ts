import { expect, test, type Page } from "@playwright/test";
import { line } from "../fake-ocr.ts";
import { useBujo } from "./harness.ts";
import { doneButton, openGallery, openScan } from "./scan-helpers.ts";

const app = useBujo();

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const photo = (name: string) => ({ name, mimeType: "image/png", buffer: PNG });
const FIRST = [line("•", "Eins Brot", 0.9)];
const SECOND = [line("•", "Zwei Post", 0.9)];

test.beforeEach(async ({ page }) => {
  await app.signIn(page);
  app.ocr.failWith(0);
  app.ocr.delay(0);
  app.ocr.script([]);
  app.ocr.setPage(null);
  app.ocr.setPageNumber(undefined);
});

/** Opens the camera screen on the log page (its camera chooser is ignored: photos go in through the input). */
async function openCamera(page: Page): Promise<void> {
  await page.goto(app.baseUrl);
  await openScan(page);
}

/** One shutter photo: the camera input gets a file, as the phone camera hands one over. */
const shoot = (page: Page, name: string) => page.locator("#scan-file").setInputFiles(photo(name));
const thumbs = (page: Page) => page.getByTestId("scan-thumb");

test("shutter photos wait in a strip with a counter, a thumbnail can be removed, and Done reads the rest as a two page batch", async ({ page }) => {
  app.ocr.script([{ lines: FIRST }, { lines: SECOND }]);
  await openCamera(page);
  await expect(page.getByTestId("scan-tray")).toBeHidden();
  const before = app.ocr.requests.length;

  for (const name of ["a.png", "b.png", "c.png"]) await shoot(page, name);
  await expect(thumbs(page)).toHaveCount(3);
  await expect(page.getByTestId("scan-count")).toHaveText("3 of 10 pages");
  expect(app.ocr.requests.length).toBe(before);

  await thumbs(page).nth(1).locator("[data-action=thumb-remove]").click();
  await expect(thumbs(page)).toHaveCount(2);
  await expect(page.getByTestId("scan-count")).toHaveText("2 of 10 pages");

  await doneButton(page).click();
  await expect(page.getByTestId("scan-page-of")).toHaveText("Page 1 of 2");
  expect(app.ocr.requests.length).toBe(before + 2);
});

test("one shutter photo and Done reads like a single scan, with no page steps", async ({ page }) => {
  app.ocr.setLines(FIRST);
  await openCamera(page);
  await shoot(page, "a.png");
  await doneButton(page).click();
  await expect(page.getByTestId("scan-review")).toBeVisible();
  await expect(page.getByTestId("scan-steps")).toHaveCount(0);
});

test("the shutter goes off at ten pages and says so, and removing one turns it back on", async ({ page }) => {
  await openCamera(page);
  for (let index = 0; index < 10; index += 1) await shoot(page, `p${index}.png`);
  await expect(thumbs(page)).toHaveCount(10);
  await expect(page.locator("[data-action=shutter]")).toBeDisabled();
  await expect(page.getByTestId("scan-gallery-hint")).toContainText("the most one scan holds");
  await thumbs(page).first().locator("[data-action=thumb-remove]").click();
  await expect(page.locator("[data-action=shutter]")).toBeEnabled();
});

test("gallery photos join the pages already taken, and start their own batch when none are taken", async ({ page }) => {
  app.ocr.script([{ lines: FIRST }, { lines: SECOND }]);
  await page.goto(app.baseUrl);
  await openScan(page);
  await shoot(page, "a.png");
  await page.locator("#scan-gallery").setInputFiles([photo("g1.png")]);
  await expect(thumbs(page)).toHaveCount(2);

  app.ocr.script([{ lines: FIRST }, { lines: SECOND }]);
  await page.reload();
  const before = app.ocr.requests.length;
  await openGallery(page).then((chooser) => chooser.setFiles([photo("g1.png"), photo("g2.png")]));
  await expect(page.getByTestId("scan-page-of")).toHaveText("Page 1 of 2");
  expect(app.ocr.requests.length).toBe(before + 2);
});
