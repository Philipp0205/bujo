import { expect, test, type Locator, type Page } from "@playwright/test";
import { useBujo } from "./harness.ts";

const app = useBujo();

test.beforeEach(async ({ page }) => {
  await app.signIn(page);
  // The install banner and the what's new sheet would sit over the log, so both are out of the way before any page script runs.
  await page.addInitScript(() => sessionStorage.setItem("ak-install-prompt-dismissed", "1"));
  await page.request.put(`${app.baseUrl}/api/whats-new/seen`, { data: { id: "2026-11-23-quick-fixes-2" } });
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

/** The sheet that scrolls the whole log page: the title, the switcher, the date row and the rows. */
const sheet = (page: Page) => page.locator("#log");

/** The y below which the tab bar starts (the bar is 84px tall at 390x844): dots are read above it. */
const ABOVE_BAR = 760;

/** The distance of every pair of neighbouring dots in a column is 24px: the grid is one unbroken piece. */
function expectUnbroken(dots: number[]): void {
  expect(dots.length).toBeGreaterThan(8);
  for (let i = 1; i < dots.length; i++) expect(Math.abs(dots[i] - dots[i - 1] - 24)).toBeLessThanOrEqual(1);
}

test("on a long Daily page the dots scroll with the rows", async ({ page }) => {
  await seedMany(page, 0);
  await openLog(page);
  await checkTravels(page, sheet(page), page.locator(".paper-row").first());
});

test("the log keeps one grid: it is painted once, on the scrolling sheet, and runs unbroken from the top of the screen through the header into the rows", async ({ page }) => {
  await seedMany(page, 0);
  await openLog(page);
  const rowTop = (await page.locator(".paper-row").first().boundingBox())!.y;
  expectUnbroken(await dotYs(page, 4, 0, rowTop + 240));

  // The bands paint no dots of their own, and the page-turning unit paints none either, so nothing keeps still while the sheet moves.
  for (const selector of [".paper-head", ".view-switcher", ".page-head", ".page-body", ".paper-page"]) {
    expect(await page.locator(selector).first().evaluate((el) => getComputedStyle(el).backgroundImage), selector).toBe("none");
  }
  const own = await sheet(page).evaluate((el) => {
    const style = getComputedStyle(el);
    return { image: style.backgroundImage, attachment: style.backgroundAttachment, size: style.backgroundSize };
  });
  expect(own.image).toContain("radial-gradient");
  expect(own.attachment).toBe("local");
  expect(own.size).toContain("24px 24px");

  // After a scroll that is not a multiple of the grid the header is gone, and the dots still run unbroken over the whole screen.
  await scrollTo(page, sheet(page), 301);
  expect(await page.getByTestId("page-head").boundingBox().then((box) => box!.y + box!.height)).toBeLessThan(0);
  expectUnbroken(await dotYs(page, 4, 0, ABOVE_BAR));
});

test("the dots run on through the status-bar inset, with no seam above the title", async ({ page }) => {
  await seedMany(page, 0);
  await page.addInitScript(() => {
    const style = document.createElement("style");
    style.textContent = ":root { --ak-safe-top: 40px !important; }";
    document.addEventListener("DOMContentLoaded", () => document.head.appendChild(style));
  });
  await openLog(page);
  expect(await sheet(page).evaluate((el) => getComputedStyle(el).paddingTop)).toBe("40px");
  expectUnbroken(await dotYs(page, 4, 0, 400));
  await scrollTo(page, sheet(page), 101);
  expectUnbroken(await dotYs(page, 4, 0, ABOVE_BAR));
});

test("in Month the dots scroll with the rows", async ({ page }) => {
  await seedMany(page, 0);
  await openLog(page);
  await page.getByTestId("view-month").click();
  await expect(page.getByTestId("month-heading")).toBeVisible();
  await checkTravels(page, sheet(page), page.locator(".paper-row").first());
});

test("with rows selected the pinned bar keeps the dots of the sheet under it, with no seam", async ({ page }) => {
  await seedMany(page, 0);
  await openLog(page);
  await scrollTo(page, sheet(page), 301);
  const box = (await page.locator(".paper-row", { hasText: "Zeile 15" }).first().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
  const bar = page.getByTestId("select-bar");
  await expect(bar).toBeVisible();
  await scrollTo(page, sheet(page), 301);
  expect((await bar.boundingBox())!.y).toBe(0);
  // The bar's own hairline (y 95) is not a dot: read the dots of the bar and of the rows below it as one column.
  const above = await dotYs(page, 4, 0, 94);
  const below = await dotYs(page, 4, 97, ABOVE_BAR);
  expectUnbroken([...above, ...below]);
});

test("in Not on paper the dots scroll with the rows", async ({ page }) => {
  await seedMany(page, -3);
  await openLog(page);
  await page.getByTestId("not-on-paper-open").click();
  const sheet = page.getByTestId("not-on-paper-sheet");
  await expect(sheet.getByTestId("not-on-paper-row").first()).toBeVisible();
  await checkTravels(page, sheet.locator(".ak-sheet-scroll"), sheet.getByTestId("not-on-paper-row").first());
});
