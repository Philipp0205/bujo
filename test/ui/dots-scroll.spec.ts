import { expect, test, type Locator, type Page } from "@playwright/test";
import { useBujo } from "./harness.ts";

const app = useBujo();

test.beforeEach(async ({ page }) => {
  await app.signIn(page);
  // The install banner and the what's new sheet would sit over the log, so both are out of the way before any page script runs.
  await page.addInitScript(() => sessionStorage.setItem("ak-install-prompt-dismissed", "1"));
  await page.request.put(`${app.baseUrl}/api/whats-new/seen`, { data: { id: "2026-11-23-scan-page-kind" } });
});

const pad = (n: number) => String(n).padStart(2, "0");

/** A calendar day as YYYY-MM-DD in the local time zone, n days from today (the page uses the local day too). */
function day(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Every entry of the throwaway account in the window the specs seed into goes, so each test starts from an empty log. */
test.afterEach(async ({ page }) => {
  const response = await page.request.get(`${app.baseUrl}/api/entries?from=${day(-20)}&to=${day(40)}`);
  for (const entry of (await response.json()).entries as Array<{ id: string }>) await page.request.delete(`${app.baseUrl}/api/entries/${entry.id}`);
});

/** Thirty fake tasks on the given day, enough to scroll a phone screen. Never a real list. */
async function seedMany(page: Page, offset: number, titles = 30): Promise<void> {
  for (let i = 1; i <= titles; i++) {
    const response = await page.request.post(`${app.baseUrl}/api/entries`, { data: { date: day(offset), type: "task", title: `Zeile ${i}` } });
    expect(response.status()).toBe(201);
  }
}

/** Opens the log and waits until its scripts are wired. */
async function openLog(page: Page): Promise<void> {
  await page.goto(app.baseUrl);
  await expect(page.getByRole("heading", { name: "Daily Log", level: 1 })).toBeVisible();
  await page.waitForFunction(() => !!document.querySelector(".paper-add"));
}

/**
 * The y of every dot in a narrow, empty column of the screen between top and bottom (CSS pixels, from the top of the viewport).
 * The column is read from a real screenshot, so what counts is where the dots are painted, not which CSS rule paints them.
 */
async function dotYs(page: Page, x: number, top: number, bottom: number): Promise<number[]> {
  const png = await page.screenshot({ clip: { x, y: top, width: 12, height: bottom - top }, scale: "css" });
  const reader = await page.context().newPage();
  try {
    const ys = await reader.evaluate(async (base64: string) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const sums: number[] = [];
      for (let i = 0; i < data.length; i += 4) sums.push(data[i] + data[i + 1] + data[i + 2]);
      const paper = [...sums].sort((a, b) => a - b)[Math.floor(sums.length / 2)];
      const marked: boolean[] = [];
      for (let y = 0; y < canvas.height; y++) {
        let hit = false;
        for (let x = 0; x < canvas.width; x++) if (Math.abs(sums[y * canvas.width + x] - paper) >= 20) hit = true;
        marked.push(hit);
      }
      const centres: number[] = [];
      let start = -1;
      marked.forEach((on, y) => {
        if (on && start < 0) start = y;
        if (!on && start >= 0) { centres.push((start + y - 1) / 2); start = -1; }
      });
      return centres;
    }, png.toString("base64"));
    return ys.map((y) => y + top);
  } finally {
    await reader.close();
  }
}

/** Where a dot sits relative to the top of a row: 0 to 24, the distance from the row down to the next dot at or below it. */
function phase(dots: number[], rowTop: number): number {
  const first = dots[0] - rowTop;
  return ((first % 24) + 24) % 24;
}

/** The distance of two phases on the 24px circle. */
function apart(a: number, b: number): number {
  const d = Math.abs(a - b) % 24;
  return Math.min(d, 24 - d);
}

/** Scrolls a scroller to a position that is not a multiple of the grid, and waits one frame for the paint. */
async function scrollTo(page: Page, scroller: Locator, top: number): Promise<void> {
  await scroller.evaluate((el, y) => { el.scrollTop = y; }, top);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/** Waits until a node has stopped moving (a sheet slides in), so a screenshot of it is not taken mid-animation. */
async function settled(page: Page, node: Locator): Promise<void> {
  let last = "";
  await expect.poll(async () => {
    const box = JSON.stringify(await node.boundingBox());
    const same = box === last;
    last = box;
    return same;
  }, { intervals: [120] }).toBe(true);
}

/** The dots of a scroller's left margin (clear of rows) and where its first row sits, before and after a scroll of 37px. */
async function checkTravels(page: Page, scroller: Locator, row: Locator): Promise<void> {
  await settled(page, scroller);
  const box = (await scroller.boundingBox())!;
  const x = box.x + 4;
  const top = box.y + 4;
  const bottom = box.y + 300;
  await scrollTo(page, scroller, 0);
  const rowBefore = (await row.boundingBox())!.y;
  const before = await dotYs(page, x, top, bottom);
  expect(before.length).toBeGreaterThan(8);
  await scrollTo(page, scroller, 37);
  const moved = await scroller.evaluate((el) => el.scrollTop);
  expect(moved).toBe(37);
  const rowAfter = (await row.boundingBox())!.y;
  expect(Math.round(rowBefore - rowAfter)).toBe(37);
  const after = await dotYs(page, x, top, bottom);
  expect(after.length).toBeGreaterThan(8);
  // The rows moved up 37px. A grid that travels with them keeps its place against the row; a fixed one does not (37px is 13px off the 24px grid).
  expect(apart(phase(after, rowAfter), phase(before, rowBefore))).toBeLessThanOrEqual(1);
}

test("on a long Daily page the dots scroll with the rows", async ({ page }) => {
  await seedMany(page, 0);
  await openLog(page);
  const body = page.getByTestId("page-body");
  await checkTravels(page, body, page.locator(".paper-row").first());
});

test("the log keeps one grid: the bands above the body line up with the body's dots, and the log itself paints none", async ({ page }) => {
  await seedMany(page, 0, 6);
  await openLog(page);
  const body = (await page.getByTestId("page-body").boundingBox())!;
  const dots = await dotYs(page, 4, 0, body.y + 240);
  expect(dots.length).toBeGreaterThan(8);
  for (let i = 1; i < dots.length; i++) expect(Math.abs(dots[i] - dots[i - 1] - 24)).toBeLessThanOrEqual(1);
  expect(await page.locator("#log").evaluate((el) => getComputedStyle(el).backgroundImage)).toBe("none");
});

test("in Month the dots scroll with the rows", async ({ page }) => {
  await seedMany(page, 0);
  await openLog(page);
  await page.getByTestId("view-month").click();
  await expect(page.getByTestId("month-heading")).toBeVisible();
  await checkTravels(page, page.getByTestId("page-body"), page.locator(".paper-row").first());
});

test("in Not on paper the dots scroll with the rows", async ({ page }) => {
  await seedMany(page, -3);
  await openLog(page);
  await page.getByTestId("not-on-paper-open").click();
  const sheet = page.getByTestId("not-on-paper-sheet");
  await expect(sheet.getByTestId("not-on-paper-row").first()).toBeVisible();
  await checkTravels(page, sheet.locator(".ak-sheet-scroll"), sheet.getByTestId("not-on-paper-row").first());
});
