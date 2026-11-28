import { expect, test } from "@playwright/test";
import { pinClock, pinnedDay, useBujo, WHATS_NEW_NEWEST } from "./harness.ts";

const app = useBujo();

test.beforeEach(async ({ page }) => {
  await pinClock(page);
});

const today = () => pinnedDay(0);

test("a one-line row is 48px and a wrapped row is a whole number of 24px grid units", async ({ page }) => {
  await app.signIn(page);
  await page.addInitScript(() => sessionStorage.setItem("ak-install-prompt-dismissed", "1"));
  await page.request.put(`${app.baseUrl}/api/whats-new/seen`, { data: { id: WHATS_NEW_NEWEST } });
  const titles = ["Grid short", "Grid two lines of words that need to wrap onto a second line", "Grid long title that keeps going and going so that it wraps onto a third line and maybe even more than that, yes"];
  for (const title of titles) {
    const response = await page.request.post(`${app.baseUrl}/api/entries`, { data: { date: today(), horizon: "day", type: "task", title } });
    expect(response.status()).toBe(201);
  }
  await page.goto(app.baseUrl);
  await page.waitForFunction(() => !!document.querySelector(".paper-add"));
  // Row heights depend on the font metrics: measure only once the fonts are in and every row has been laid out.
  await expect(page.locator(".paper-row", { hasText: "Grid" })).toHaveCount(3);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  const heights = await page.locator(".paper-row", { hasText: "Grid" }).evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height));
  expect(heights).toHaveLength(3);
  expect(heights[0]).toBe(48);
  for (const height of heights) expect(height % 24).toBe(0);
  expect(heights[1]).toBeGreaterThan(48);
  expect(heights[2]).toBeGreaterThan(heights[1]);

  for (const entry of (await (await page.request.get(`${app.baseUrl}/api/entries?from=${today()}&to=${today()}`)).json()).entries as Array<{ id: string }>) {
    await page.request.delete(`${app.baseUrl}/api/entries/${entry.id}`);
  }
});
