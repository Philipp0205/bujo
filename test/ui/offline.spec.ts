import { expect, test, type Page } from "@playwright/test";
import { useBujo } from "./harness.ts";
import { addTab } from "./scan-helpers.ts";

const app = useBujo();

test.beforeEach(async ({ page }) => {
  await app.signIn(page);
  // The install banner and the what's new sheet would sit over the log, so both are out of the way before any page script runs.
  await page.addInitScript(() => sessionStorage.setItem("ak-install-prompt-dismissed", "1"));
  await page.request.put(`${app.baseUrl}/api/whats-new/seen`, { data: { id: "2026-11-23-fonts" } });
});

const title = (page: Page) => page.getByRole("textbox", { name: "Entry title" });
const row = (page: Page, text: string) => page.locator(".paper-row", { hasText: text });
const waiting = (page: Page) => page.getByTestId("waiting-to-send");

/** Opens the log online, so its rows and scripts are in the page before the connection goes. The service worker is blocked in
 * tests, so the page cannot be reloaded offline here (the real app also opens from the service worker cache). */
async function openLog(page: Page): Promise<void> {
  await page.goto(app.baseUrl);
  await expect(page.getByRole("heading", { name: "Daily Log", level: 1 })).toBeVisible();
  await page.waitForFunction(() => !!document.querySelector(".paper-add"));
}

/** Types one line in the Add sheet and saves it with Enter (which closes the sheet), then waits for its row. */
async function addLine(page: Page, text: string): Promise<void> {
  await addTab(page).click();
  await title(page).fill(text);
  await page.keyboard.press("Enter");
  await expect(row(page, text)).toBeVisible();
  await expect(page.getByTestId("edit-sheet")).toBeHidden();
}

/** The titles the server holds for the account that contain a word, read through its own API (a window of days around today). */
async function serverTitles(page: Page, word: string): Promise<string[]> {
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const response = await page.request.get(`${app.baseUrl}/api/entries?from=${day(-10)}&to=${day(10)}`);
  const titles: string[] = (await response.json()).entries.map((entry: { title: string }) => entry.title);
  return titles.filter((text) => text.includes(word));
}

test("an entry written offline shows as waiting to send, then goes out once when the connection is back", async ({ page }) => {
  await openLog(page);
  await page.context().setOffline(true);
  await expect(page.getByTestId("offline-hint")).toBeVisible();

  await addLine(page, "Offline alpha");
  await expect(row(page, "Offline alpha")).toHaveAttribute("data-queued", "create");
  await expect(row(page, "Offline alpha").getByTestId("waiting-to-send")).toBeVisible();

  await addLine(page, "Offline beta");
  await expect(waiting(page)).toHaveCount(2);

  await page.context().setOffline(false);
  await expect(waiting(page)).toHaveCount(0);
  await expect(page.getByTestId("offline-hint")).toHaveCount(0);
  await expect(row(page, "Offline alpha")).toHaveCount(1);
  await expect(row(page, "Offline beta")).toHaveCount(1);
  expect(await serverTitles(page, "Offline ")).toEqual(["Offline alpha", "Offline beta"]);
});

test("a queued entry survives a reload and is sent after it", async ({ page }) => {
  await openLog(page);
  // The page cannot reach the server for entries, so the line is queued, and the queue is in IndexedDB.
  await page.route("**/api/entries", (route) => (route.request().method() === "POST" ? route.abort() : route.continue()));
  await addLine(page, "Kept on the phone");
  await expect(waiting(page)).toHaveCount(1);
  expect(await serverTitles(page, "Kept on")).toEqual([]);

  // The boot flush posts the queue as the page comes back. An aborted POST can make Playwright
  // treat the navigation itself as net::ERR_ABORTED if we wait for "load" or "domcontentloaded".
  // Wait only until the document commits; if that still throws, the heading below is the real gate.
  // The queue is in IndexedDB either way.
  try {
    await page.goto(app.baseUrl, { waitUntil: "commit" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/net::ERR_ABORTED|net::ERR_FAILED/.test(message)) throw error;
  }
  await expect(page.getByRole("heading", { name: "Daily Log", level: 1 })).toBeVisible();
  await expect(row(page, "Kept on the phone").getByTestId("waiting-to-send")).toBeVisible();

  await page.unroute("**/api/entries");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(waiting(page)).toHaveCount(0);
  await expect(row(page, "Kept on the phone")).toHaveCount(1);
  expect(await serverTitles(page, "Kept on")).toEqual(["Kept on the phone"]);
});

test("a send that was lost on the way is repeated without making a second entry", async ({ page }) => {
  await openLog(page);
  // The server stores the entry, but the answer never arrives: the page treats it as a miss and queues the same id.
  await page.route("**/api/entries", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fetch();
    return route.abort("connectionreset");
  }, { times: 1 });
  await addLine(page, "Answer got lost");
  await expect(waiting(page)).toHaveCount(1);

  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(waiting(page)).toHaveCount(0);
  await expect(row(page, "Answer got lost")).toHaveCount(1);
  expect(await serverTitles(page, "Answer got")).toEqual(["Answer got lost"]);
});

test("Notes keeps its last grid and says it is offline", async ({ page }) => {
  await page.request.post(`${app.baseUrl}/api/entries`, { data: { date: "2026-11-20", type: "note", title: "A saved note", body: "text" } });
  await page.goto(`${app.baseUrl}/notes`);
  await expect(page.getByTestId("note-grid")).toBeVisible();
  // The log joins the document in the background; the tab switch below needs it there, as no page can load offline.
  await page.waitForFunction(() => !!document.querySelector("#log") && !!document.querySelector('script[src="/js/log/main.js"]'));
  await page.waitForTimeout(500);
  await page.context().setOffline(true);
  const bar = page.getByRole("navigation", { name: "Main" });
  await bar.locator("[data-tab=log]").click();
  await expect(page.getByTestId("offline-hint")).toBeVisible();
  await bar.locator("[data-tab=notes]").click();
  const notes = page.getByRole("main", { name: "Notes" });
  await expect(notes.getByTestId("note-grid")).toBeVisible();
  await expect(notes.getByTestId("offline-hint")).toBeVisible();
  await expect(notes.locator("[data-state=error]")).toHaveCount(0);
});
