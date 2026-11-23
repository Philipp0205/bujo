import { expect, test, type Page } from "@playwright/test";
import { useBujo } from "./harness.ts";

const app = useBujo();

test.beforeEach(async ({ page }) => {
  await app.signIn(page);
  await page.addInitScript(() => sessionStorage.setItem("ak-install-prompt-dismissed", "1"));
  await page.request.put(`${app.baseUrl}/api/whats-new/seen`, { data: { id: "2026-11-23-fonts" } });
});

/** The entries this spec made in its own throwaway database, removed after each test. */
const made: string[] = [];

test.afterEach(async ({ page }) => {
  for (const id of made.splice(0)) await page.request.delete(`${app.baseUrl}/api/entries/${id}`);
});

function today(): string {
  const date = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** A fake entry through the API with the page's session. Never a real list. */
async function seed(page: Page, title: string, important = false, type = "task"): Promise<string> {
  const response = await page.request.post(`${app.baseUrl}/api/entries`, { data: { date: today(), type, title, important } });
  expect(response.status()).toBe(201);
  const id: string = (await response.json()).entry.id;
  made.push(id);
  return id;
}

async function serverEntry(page: Page, id: string): Promise<{ type: string; important: boolean } | undefined> {
  const response = await page.request.get(`${app.baseUrl}/api/entries?from=${today()}&to=${today()}`);
  return ((await response.json()).entries as Array<{ id: string; type: string; important: boolean }>).find((entry) => entry.id === id);
}

const row = (page: Page, title: string) => page.locator(".paper-row", { hasText: title });
const marker = (page: Page, title: string) => row(page, title).locator(".paper-sym");
const toggle = (page: Page) => page.getByTestId("important-toggle");

async function openLog(page: Page): Promise<void> {
  await page.goto(app.baseUrl);
  await expect(page.getByRole("heading", { name: "Daily Log", level: 1 })).toBeVisible();
  await page.waitForFunction(() => !!document.querySelector(".paper-add"));
}

async function hold(page: Page, title: string): Promise<void> {
  const box = (await marker(page, title).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
}

test("an important row shows a * in the margin before the bullet, off the left edge and clear of the title", async ({ page }) => {
  await seed(page, "Wichtig", true);
  await seed(page, "Gewohnt");
  await openLog(page);

  const star = row(page, "Wichtig").getByTestId("important-star");
  await expect(star).toBeVisible();
  await expect(row(page, "Gewohnt").getByTestId("important-star")).toHaveCount(0);
  const [s, bullet, title] = await Promise.all([star.boundingBox(), marker(page, "Wichtig").boundingBox(), row(page, "Wichtig").locator(".paper-title").boundingBox()]);
  expect(s!.x).toBeGreaterThanOrEqual(24);
  expect(s!.x + s!.width).toBeLessThanOrEqual(bullet!.x + bullet!.width / 2);
  expect(s!.x + s!.width).toBeLessThanOrEqual(title!.x);
});

test("the hold picker turns important on and off, and the type stays", async ({ page }) => {
  const id = await seed(page, "Umschalten");
  await openLog(page);

  await hold(page, "Umschalten");
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
  await toggle(page).click();
  await expect(row(page, "Umschalten").getByTestId("important-star")).toBeVisible();
  await expect.poll(async () => (await serverEntry(page, id))?.important).toBe(true);
  expect((await serverEntry(page, id))?.type).toBe("task");

  await hold(page, "Umschalten");
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  await toggle(page).click();
  await expect(row(page, "Umschalten").getByTestId("important-star")).toHaveCount(0);
  await expect.poll(async () => (await serverEntry(page, id))?.important).toBe(false);
});

test("a tap on the bullet of an important task still marks it done and keeps the star", async ({ page }) => {
  const id = await seed(page, "Erledigen", true);
  await openLog(page);

  await marker(page, "Erledigen").click();
  await expect(row(page, "Erledigen")).toHaveAttribute("data-type", "done");
  await expect(row(page, "Erledigen").getByTestId("important-star")).toBeVisible();
  await expect.poll(async () => (await serverEntry(page, id))?.type).toBe("done");
  expect((await serverEntry(page, id))?.important).toBe(true);
  await expect(page.getByTestId("edit-sheet")).toBeHidden();
});
