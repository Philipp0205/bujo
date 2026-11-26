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

/** A calendar day as YYYY-MM-DD in the local time zone, n days from today. */
function day(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const headerLine = (iso: string) => line("none", `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`, 0.9);
const review = (page: Page) => page.getByTestId("scan-review");
const bullets = (titles: string[]) => titles.map((title) => line("•", title, 0.9));

test.afterEach(async ({ page }) => {
  const { entries } = await (await page.request.get(`${app.baseUrl}/api/entries?from=${day(-5)}&to=${day(1)}`)).json();
  for (const entry of entries) await page.request.delete(`${app.baseUrl}/api/entries/${entry.id}`);
});

/** Files one physical page of a day through the API (scan, then apply every line), as a person who scanned it earlier. */
async function seedPage(page: Page, date: string, number: number, titles: string[]): Promise<void> {
  app.ocr.setLines([headerLine(date), ...bullets(titles)]);
  const scan = await page.request.post(`${app.baseUrl}/api/log/scan?date=${date}&picked=1`, { headers: { "content-type": "image/png" }, data: PNG });
  const draft = (await scan.json()).draft;
  const items = draft.items.map((i: any) => ({ id: i.id, type: i.type, title: i.title, tags: i.tags, time: i.time }));
  expect((await page.request.post(`${app.baseUrl}/api/log/scan/${draft.id}/apply`, { data: { date, page: number, items } })).status()).toBe(200);
}

/** The day heading as the review words it: "Wednesday 18.11". */
function heading(iso: string): string {
  const [year, month, dayOfMonth] = iso.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, dayOfMonth)).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
  return `${weekday} ${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
}

async function dayEntries(page: Page, date: string): Promise<Array<{ title: string; page: number | null }>> {
  const response = await page.request.get(`${app.baseUrl}/api/entries?from=${date}&to=${date}`);
  return (await response.json()).entries.map((e: { title: string; page: number | null }) => ({ title: e.title, page: e.page }));
}

test("scanning from yesterday's page files on yesterday, not today", async ({ page }) => {
  await seedPage(page, day(-1), 1, ["Bravo"]);
  await page.goto(`${app.baseUrl}/?day=${day(-1)}`);
  app.ocr.setLines(bullets(["Alpha"]));
  await (await openScan(page)).setFiles(photo);
  await expect(review(page)).toBeVisible();
  await expect(page.getByTestId("scan-date")).toHaveText(heading(day(-1)));
  await expect(page.getByTestId("scan-date-source")).toHaveText("Open day, no date found");
  await review(page).locator("[data-action=apply]").click();
  await expect(review(page)).toHaveCount(0);
  expect(await dayEntries(page, day(-1))).toEqual([{ title: "Bravo", page: 1 }, { title: "Alpha", page: 2 }]);
  expect(await dayEntries(page, day(0))).toEqual([]);
});

test("a day picked on the camera screen beats the date on the page, and the review shows it as picked", async ({ page }) => {
  app.ocr.setLines([headerLine(day(-3)), ...bullets(["Alpha"])]);
  await page.goto(app.baseUrl);
  const chooser = await openScan(page);
  await expect(page.getByTestId("scan-pick-note")).toHaveText("a date on the page wins");
  await page.locator("[data-field=scan-day]").fill(day(-1));
  await expect(page.getByTestId("scan-pick-note")).toHaveText("picked by you");
  await chooser.setFiles(photo);
  await expect(review(page)).toBeVisible();
  await expect(page.getByTestId("scan-date-source")).toHaveText("Picked by you");
  await review(page).locator("[data-action=apply]").click();
  await expect(review(page)).toHaveCount(0);
  expect(await dayEntries(page, day(-1))).toEqual([{ title: "Alpha", page: 1 }]);
  expect(await dayEntries(page, day(-3))).toEqual([]);
});

test("the date read from the page is used when nothing is picked, and it can be edited in the review", async ({ page }) => {
  app.ocr.setLines([headerLine(day(-3)), ...bullets(["Alpha"])]);
  await page.goto(app.baseUrl);
  await (await openScan(page)).setFiles(photo);
  await expect(review(page)).toBeVisible();
  await expect(page.getByTestId("scan-date-source")).toHaveText("Read from the page");
  await page.locator("[data-field=date]").fill(day(-2));
  await expect(page.getByTestId("scan-date-source")).toHaveText("Picked by you");
  await review(page).locator("[data-action=apply]").click();
  await expect(review(page)).toHaveCount(0);
  expect(await dayEntries(page, day(-2))).toEqual([{ title: "Alpha", page: 1 }]);
  expect(await dayEntries(page, day(-3))).toEqual([]);
});

test("a rescan with the lines in another order moves the matched entries, says so in the review, and the log shows C, A, B", async ({ page }) => {
  const date = day(-1);
  await seedPage(page, date, 1, ["Alpha", "Bravo", "Charlie"]);
  await page.goto(`${app.baseUrl}/?day=${date}`);
  app.ocr.setLines(bullets(["Charlie", "Alpha", "Bravo"]));
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByTestId("rescan-page").click()]);
  await chooser.setFiles(photo);
  await expect(review(page)).toBeVisible();
  await expect(review(page).locator("[data-role=match]").first()).toContainText("moves to position 1");
  await expect(review(page).locator("[data-role=match]").nth(1)).not.toContainText("moves to");
  await expect(review(page).locator("[data-action=apply]")).toHaveText("Apply new order");
  await review(page).locator("[data-action=apply]").click();
  await expect(review(page)).toHaveCount(0);
  await expect(page.locator(".paper-row:not(.paper-trace) .paper-title")).toHaveText(["Charlie", "Alpha", "Bravo"]);
  expect(await dayEntries(page, date)).toEqual([{ title: "Charlie", page: 1 }, { title: "Alpha", page: 1 }, { title: "Bravo", page: 1 }]);
});

test("a rescan of page 1 updates and reorders page 1 in the log and leaves page 2 alone", async ({ page }) => {
  const date = day(-1);
  await seedPage(page, date, 1, ["Call dentist", "Buy bread"]);
  await seedPage(page, date, 2, ["Pack bag"]);
  await page.goto(`${app.baseUrl}/?day=${date}`);
  app.ocr.setLines(bullets(["Buy bread", "Call dentist", "Water plants"]));
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByTestId("rescan-page").click()]);
  await chooser.setFiles(photo);
  await expect(review(page)).toBeVisible();
  await expect(page.getByTestId("scan-date-source")).toHaveText("Picked by you");
  await review(page).locator("[data-action=apply]").click();
  await expect(review(page)).toHaveCount(0);
  await expect(page.locator(".paper-row:not(.paper-trace) .paper-title")).toHaveText(["Buy bread", "Call dentist", "Water plants", "Pack bag"]);
  expect(await dayEntries(page, date)).toEqual([
    { title: "Buy bread", page: 1 }, { title: "Call dentist", page: 1 }, { title: "Water plants", page: 1 }, { title: "Pack bag", page: 2 },
  ]);
});
