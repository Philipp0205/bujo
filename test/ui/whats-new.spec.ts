import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { useBujo, WHATS_NEW_NEWEST } from "./harness.ts";

const app = useBujo();

type Entry = { id: string; date: string; title: string };

/** The shipped catalog, newest first, so counts and the newest entry never need hand edits. */
const CATALOG: Entry[] = JSON.parse(readFileSync(new URL("../../public/whats-new.json", import.meta.url), "utf8"));
const NEWEST = WHATS_NEW_NEWEST;
const OLDEST = CATALOG[CATALOG.length - 1].id;
const UNSEEN_COUNT = CATALOG.length - 1;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Mirrors AppKit.whatsNew.formatEntryDate ("2026-11-05" becomes "5 Nov 2026"), which the sheet uses. */
function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
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

/** Loads the daily log and waits until the what's-new boot has asked the account, so "no sheet" is a settled answer. */
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

test("the harness newest id is the first catalog entry", () => {
  expect(CATALOG[0].id).toBe(NEWEST);
});

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
  // Every entry newer than the oldest is shown. The oldest is not shown again.
  await expect(sheet.locator("[data-entry-id]")).toHaveCount(UNSEEN_COUNT);
  await expect(sheet.locator(`[data-entry-id="${OLDEST}"]`)).toHaveCount(0);
  const newest = sheet.locator(`[data-entry-id="${NEWEST}"]`);
  await expect(newest.locator(".wn-date")).toHaveText(formatDate(CATALOG[0].date));
  await expect(newest).toContainText(CATALOG[0].title);

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
  await expect(sheet.locator("[data-entry-id]")).toHaveCount(CATALOG.length);
  await expect(sheet.locator(`[data-entry-id="${OLDEST}"]`)).toBeVisible();

  await closeAndWaitForStore(page);
  expect((await (await page.request.get(`${app.baseUrl}${SEEN_API}`)).json()).seen).toBe(NEWEST);
  expect(await page.evaluate(() => localStorage.getItem("bujo-whats-new-seen"))).toBe(NEWEST);

  // Everything is seen now and the list can still be opened again.
  await page.locator("[data-action=open-whats-new]").click();
  await expect(sheet.locator("[data-entry-id]")).toHaveCount(CATALOG.length);
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
