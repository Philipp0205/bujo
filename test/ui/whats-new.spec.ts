import { expect, test, type Page } from "@playwright/test";
import { useBujo } from "./harness.ts";

const app = useBujo();

/** The catalog ids in public/whats-new.json, newest first. */
const NEWEST = "2026-11-22-polish";
const OLDEST = "2026-11-21-scan-gallery";
const SEEN_API = "/api/whats-new/seen";

test.beforeEach(async ({ page }) => {
  await app.signIn(page);
  // The install banner would sit over the sheet, so it is dismissed for the session before any page script runs.
  await page.addInitScript(() => sessionStorage.setItem("ak-install-prompt-dismissed", "1"));
});

/** Sets what the account has seen, through the public API. Sign-up already wrote the newest id, so tests start from an older one. */
async function setAccountSeen(page: Page, id: string): Promise<void> {
  const put = await page.request.put(`${app.baseUrl}${SEEN_API}`, { data: { id } });
  expect(put.status()).toBe(200);
}

/** Closes the sheet with Done and waits until the seen id has reached the account. */
async function closeAndWaitForStore(page: Page): Promise<void> {
  const stored = page.waitForResponse((r) => r.url().endsWith(SEEN_API) && r.request().method() === "PUT");
  await page.locator("[data-action=whats-new-done]").click();
  await stored;
  await expect(page.locator("[data-testid=whats-new-sheet]")).toHaveCount(0);
}

/** Loads the rapid log and waits until the what's-new boot has asked the account, so "no sheet" is a settled answer. */
async function visit(page: Page, path: string): Promise<void> {
  const asked = page.waitForResponse((r) => r.url().endsWith(SEEN_API) && r.request().method() === "GET");
  await page.goto(`${app.baseUrl}${path}`);
  await asked;
}

/** Loads settings, where the account is only asked when the list is opened. */
async function visitSettings(page: Page): Promise<void> {
  await page.goto(`${app.baseUrl}/settings`);
  await expect(page.locator("[data-action=open-whats-new]")).toBeVisible();
}

test("a new sign-up skips the history: no sheet on the first visit", async ({ page }) => {
  await visit(page, "/");
  await expect(page.locator(".paper-page")).toBeVisible();
  await expect(page.locator("[data-testid=whats-new-sheet]")).toHaveCount(0);
});

test("unseen entries show once in a sheet, and not again after close, on reload or without the device copy", async ({ page }) => {
  await visit(page, "/");
  await page.evaluate(() => localStorage.removeItem("bujo-whats-new-seen"));
  await setAccountSeen(page, OLDEST);

  await visit(page, "/");
  const sheet = page.locator("[data-testid=whats-new-sheet]");
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveAttribute("data-mode", "unseen");
  // Nineteen entries are newer than the oldest one. The oldest is not shown again.
  await expect(sheet.locator("[data-entry-id]")).toHaveCount(19);
  await expect(sheet.locator(`[data-entry-id="${OLDEST}"]`)).toHaveCount(0);
  await expect(sheet.locator(`[data-entry-id="${NEWEST}"] .wn-date`)).toHaveText("22 Nov 2026");
  await expect(sheet).toContainText("Clearer rescans, fewer false marks");
  await expect(sheet).toContainText("Tabs that switch at once");
  await expect(sheet).toContainText("See what is not on paper yet");
  await expect(sheet).toContainText("Copy entries as paper lines");
  await expect(sheet).toContainText("Scan from the bottom bar");
  await expect(sheet).toContainText("Tags and days that complete themselves");
  await expect(sheet).toContainText("Settings on paper, and a theme choice");

  await closeAndWaitForStore(page);
  expect(await page.evaluate(() => localStorage.getItem("bujo-whats-new-seen"))).toBe(NEWEST);
  const account = await page.request.get(`${app.baseUrl}${SEEN_API}`);
  expect((await account.json()).seen).toBe(NEWEST);

  await visit(page, "/");
  await expect(page.locator(".paper-page")).toBeVisible();
  await expect(sheet).toHaveCount(0);

  // The account alone is enough: a device with empty storage does not replay the entries.
  await page.evaluate(() => localStorage.removeItem("bujo-whats-new-seen"));
  await visit(page, "/");
  await expect(page.locator(".paper-page")).toBeVisible();
  await expect(sheet).toHaveCount(0);
});

test("the device copy is merged with the account: an older account id does not bring entries back", async ({ page }) => {
  await visit(page, "/");
  await setAccountSeen(page, OLDEST);
  await page.evaluate((id) => localStorage.setItem("bujo-whats-new-seen", id), NEWEST);
  await visit(page, "/");
  await expect(page.locator(".paper-page")).toBeVisible();
  await expect(page.locator("[data-testid=whats-new-sheet]")).toHaveCount(0);
});

test("settings reopens the full list, and closing it stores the newest id", async ({ page }) => {
  await visitSettings(page);
  await setAccountSeen(page, OLDEST);
  await page.evaluate(() => localStorage.removeItem("bujo-whats-new-seen"));

  await page.locator("[data-action=open-whats-new]").click();
  const sheet = page.locator("[data-testid=whats-new-sheet]");
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveAttribute("data-mode", "all");
  await expect(sheet.locator("[data-entry-id]")).toHaveCount(20);
  await expect(sheet.locator(`[data-entry-id="${OLDEST}"]`)).toBeVisible();

  await closeAndWaitForStore(page);
  expect((await (await page.request.get(`${app.baseUrl}${SEEN_API}`)).json()).seen).toBe(NEWEST);
  expect(await page.evaluate(() => localStorage.getItem("bujo-whats-new-seen"))).toBe(NEWEST);

  // Everything is seen now and the list can still be opened again.
  await page.locator("[data-action=open-whats-new]").click();
  await expect(sheet.locator("[data-entry-id]")).toHaveCount(20);
});

test("entry text is shown as text, never as markup", async ({ page }) => {
  await page.route("**/whats-new.json", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify([{ id: "2026-12-01-x", date: "2026-12-01", title: "<img src=x onerror=window.__hit=1>", bullets: ["<b>bold</b>"] }]),
  }));
  await visitSettings(page);
  await setAccountSeen(page, "2026-11-21-note-photos");
  await page.locator("[data-action=open-whats-new]").click();
  const sheet = page.locator("[data-testid=whats-new-sheet]");
  await expect(sheet).toContainText("<img src=x onerror=window.__hit=1>");
  await expect(sheet).toContainText("<b>bold</b>");
  await expect(sheet.locator("img, b")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __hit?: number }).__hit)).toBeUndefined();
});
