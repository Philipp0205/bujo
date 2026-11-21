import { expect, test, type Page } from "@playwright/test";
import { openDetails, useBujo } from "./harness.ts";

const app = useBujo({ sync: true });

test.beforeEach(async ({ page }) => {
  await app.signIn(page);
});

test.afterEach(() => {
  app.fake.switches.putDelayMs = 0;
  app.fake.switches.conflictOnPut = false;
  app.fake.switches.corruptReadBack = false;
});

/** Today as YYYY-MM-DD in the local time zone, like the page. */
function today(): string {
  const date = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Creates a fake entry through the API with the page's session. The sync runs against the fake server only. */
async function create(page: Page, type: string, title: string): Promise<void> {
  const response = await page.request.post(`${app.baseUrl}/api/entries`, { data: { date: today(), type, title } });
  expect(response.status()).toBe(201);
}

const row = (page: Page, title: string) => page.locator(".paper-row", { hasText: title });
const dot = (page: Page, title: string) => row(page, title).locator(".sync-mark");

test("a task shows a pending dot, then a synced dot on its own, and a note stays local", async ({ page }) => {
  app.fake.switches.putDelayMs = 1500;
  await create(page, "task", "Müller anrufen für Übergabe");
  await create(page, "note", "Nur ein Gedanke");
  await page.goto(app.baseUrl);

  await expect(row(page, "Müller anrufen")).toHaveAttribute("data-sync", "pending");
  await expect(dot(page, "Müller anrufen")).toHaveAttribute("title", "Waiting to sync");
  await expect(row(page, "Nur ein Gedanke")).toHaveAttribute("data-sync", "local");

  await expect(row(page, "Müller anrufen")).toHaveAttribute("data-sync", "synced", { timeout: 10_000 });
  await expect(dot(page, "Müller anrufen")).toHaveAttribute("title", "Synced");
  await expect(page.locator('[data-state="error"]')).toHaveCount(0);
});

test("a failed push shows an error dot, the reason and Retry sync in the sheet, and a retry ends synced", async ({ page }) => {
  app.fake.switches.conflictOnPut = true;
  await create(page, "task", "Schlüssel abholen");
  await page.goto(app.baseUrl);
  await expect(row(page, "Schlüssel abholen")).toHaveAttribute("data-sync", "error", { timeout: 10_000 });

  await openDetails(page, "Schlüssel abholen");
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByTestId("sync-line")).toContainText("Sync failed");
  await expect(sheet.getByTestId("sync-reason")).toContainText("same moment");
  await expect(sheet.getByTestId("sync-reason")).not.toContainText("http");

  app.fake.switches.conflictOnPut = false;
  await sheet.getByRole("button", { name: "Retry sync" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(row(page, "Schlüssel abholen")).toHaveAttribute("data-sync", "synced", { timeout: 10_000 });

  await openDetails(page, "Schlüssel abholen");
  await expect(page.getByRole("dialog").getByTestId("sync-reason")).toHaveCount(0);
  await expect(page.getByRole("dialog").getByRole("button", { name: "Retry sync" })).toHaveCount(0);
});

test("no Retry sync button for a synced entry or a note", async ({ page }) => {
  await create(page, "task", "Alles gut");
  await create(page, "note", "Nur lokal hier");
  await page.goto(app.baseUrl);
  await expect(row(page, "Alles gut")).toHaveAttribute("data-sync", "synced", { timeout: 10_000 });

  for (const title of ["Alles gut", "Nur lokal hier"]) {
    await openDetails(page, title);
    await expect(page.getByRole("dialog").getByRole("button", { name: "Retry sync" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
});

test("a failing refresh while an entry is pending keeps the log on screen", async ({ page }) => {
  app.fake.switches.putDelayMs = 2500;
  await create(page, "task", "Bleibt sichtbar");
  await page.goto(app.baseUrl);
  await expect(row(page, "Bleibt sichtbar")).toHaveAttribute("data-sync", "pending");

  await page.route("**/api/entries?*", (route) => route.fulfill({ status: 500, json: { error: "boom" } }));
  await page.waitForTimeout(1500);
  await expect(page.locator('[data-state="error"]')).toHaveCount(0);
  await expect(row(page, "Bleibt sichtbar")).toBeVisible();
});
