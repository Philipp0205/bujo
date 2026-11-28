import { expect, test } from "@playwright/test";
import { pinClock, pinnedDay, useBujo, WHATS_NEW_NEWEST } from "./harness.ts";

const app = useBujo();

const today = () => pinnedDay(0);

const FACES = ["newsreader", "literata", "source-serif", "lora"];
// Titles of growing length, so in every face one of them leaves the "not synced" word near the end of the first line.
const BASE = "Pick up fresh bread at the shop and some milk";
const TITLES = Array.from({ length: 24 }, (_, i) => `${BASE.slice(0, 20 + i).trim()}.`);

async function clearDay(page: import("@playwright/test").Page) {
  const list = (await (await page.request.get(`${app.baseUrl}/api/entries?from=${today()}&to=${today()}`)).json()).entries as Array<{ id: string }>;
  for (const entry of list) await page.request.delete(`${app.baseUrl}/api/entries/${entry.id}`);
}

test.beforeEach(async ({ page }) => {
  await pinClock(page);
  await app.signIn(page);
  await page.addInitScript(() => sessionStorage.setItem("ak-install-prompt-dismissed", "1"));
  await page.request.put(`${app.baseUrl}/api/whats-new/seen`, { data: { id: WHATS_NEW_NEWEST } });
  await clearDay(page);
});

test.afterEach(async ({ page }) => { await clearDay(page); });

for (const face of FACES) {
  test(`${face}: "not synced" stays on one line, with its marks, clear of the title`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem("bujo-font", value), face);
    for (const title of TITLES) {
      const created = await page.request.post(`${app.baseUrl}/api/entries`, { data: { date: today(), horizon: "day", type: "task", title } });
      expect(created.status()).toBe(201);
    }
    await page.goto(app.baseUrl);
    await expect(page.locator(".paper-row .pill-local")).toHaveCount(TITLES.length);
    const rows = await page.locator(".paper-row").evaluateAll((els) => els.map((el) => {
      const pill = el.querySelector(".pill-local")!;
      const mark = el.querySelector(".sync-mark")!.getBoundingClientRect();
      const title = el.querySelector(".paper-title")!.getClientRects();
      const last = title[title.length - 1];
      const box = pill.getBoundingClientRect();
      return {
        pillLines: pill.getClientRects().length,
        pillHeight: box.height,
        markOnPillLine: mark.top + mark.height / 2 > box.top && mark.top + mark.height / 2 < box.bottom,
        clearOfTitle: box.top >= last.bottom - 1 || box.left >= last.right,
        height: el.getBoundingClientRect().height,
        titleLines: title.length,
      };
    }));
    for (const r of rows) {
      expect(r.pillLines).toBe(1);
      expect(r.pillHeight).toBeLessThan(30);
      expect(r.markOnPillLine).toBe(true);
      expect(r.clearOfTitle).toBe(true);
      expect(r.height % 24).toBe(0);
      if (r.titleLines === 1) expect(r.height).toBeLessThanOrEqual(72);
    }
    expect(rows.some((r) => r.height === 48)).toBe(true);
  });
}
