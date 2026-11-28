import { expect, test, type Page } from "@playwright/test";
import { useBujo, WHATS_NEW_NEWEST } from "./harness.ts";

const app = useBujo();

test.beforeEach(async ({ page }) => {
  await app.signIn(page);
  await page.addInitScript(() => sessionStorage.setItem("ak-install-prompt-dismissed", "1"));
  await page.request.put(`${app.baseUrl}/api/whats-new/seen`, { data: { id: WHATS_NEW_NEWEST } });
});

const made: string[] = [];

test.afterEach(async ({ page }) => {
  for (const id of made.splice(0)) await page.request.delete(`${app.baseUrl}/api/entries/${id}`);
});

/** Today as YYYY-MM-DD in the local time zone, which is the day the page shows. */
function today(): string {
  const date = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** A fake entry through the API with the page's session. Never a real list. */
async function seed(page: Page, type: string, title: string): Promise<void> {
  const response = await page.request.post(`${app.baseUrl}/api/entries`, { data: { date: today(), type, title } });
  expect(response.status()).toBe(201);
  made.push((await response.json()).entry.id);
}

const row = (page: Page, title: string) => page.locator(".paper-row", { hasText: title });

async function openLog(page: Page): Promise<void> {
  await page.goto(app.baseUrl);
  await expect(page.getByRole("heading", { name: "Daily Log", level: 1 })).toBeVisible();
  await page.waitForFunction(() => !!document.querySelector(".paper-add"));
}

const KINDS = ["task", "done", "migrated", "scheduled", "note", "event"];

test("every bullet kind is an svg of pen strokes with its type on it", async ({ page }) => {
  for (const kind of KINDS) await seed(page, kind, `Bullet ${kind}`);
  await openLog(page);
  for (const kind of KINDS) {
    const svg = row(page, `Bullet ${kind}`).locator(".paper-sym svg.ink-bullet");
    await expect(svg).toHaveAttribute("data-glyph", kind);
    await expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(await svg.locator("path").count()).toBeGreaterThan(0);
  }
  await expect(row(page, "Bullet done").locator("svg path")).toHaveCount(2);
  await expect(row(page, "Bullet note").locator(".paper-sym")).toHaveAttribute("aria-label", "Note");
});

test("the bullet keeps its name and a 44px hit area", async ({ page }) => {
  await seed(page, "task", "Treffer");
  await openLog(page);
  const button = row(page, "Treffer").getByTestId("toggle-done");
  await expect(button).toHaveAttribute("aria-label", "Mark as done");
  const area = await button.evaluate((el) => {
    const box = getComputedStyle(el, "::after");
    return { width: parseFloat(box.width), height: parseFloat(box.height) };
  });
  expect(area.width).toBeGreaterThanOrEqual(44);
  expect(area.height).toBeGreaterThanOrEqual(44);
});

test("checking a task off draws the x, and a list refresh does not", async ({ page }) => {
  await seed(page, "task", "Zeichnen");
  await openLog(page);
  await expect(row(page, "Zeichnen").locator(".ink-bullet.is-drawing")).toHaveCount(0);
  await row(page, "Zeichnen").getByTestId("toggle-done").click();
  await expect(row(page, "Zeichnen").locator(".ink-bullet.is-drawing")).toHaveCount(1);
  await expect(row(page, "Zeichnen").locator(".ink-bullet")).toHaveAttribute("data-glyph", "done");
  await expect(row(page, "Zeichnen").locator(".ink-bullet.is-drawing")).toHaveCount(0);
  await page.reload();
  await expect(row(page, "Zeichnen").locator(".ink-bullet.is-drawing")).toHaveCount(0);
});

test("with reduced motion the x shows at once and nothing animates", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await seed(page, "task", "Ruhig");
  await openLog(page);
  await row(page, "Ruhig").getByTestId("toggle-done").click();
  await expect(row(page, "Ruhig").locator(".ink-bullet")).toHaveAttribute("data-glyph", "done");
  await expect(row(page, "Ruhig").locator(".ink-bullet.is-drawing")).toHaveCount(0);
  expect(await row(page, "Ruhig").locator(".ink-bullet path").first().evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
});
