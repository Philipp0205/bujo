import { expect, test, type Page } from "@playwright/test";
import { useBujo } from "./harness.ts";

const app = useBujo();

test.beforeEach(async ({ page }) => {
  await app.signIn(page);
  // The install banner would sit over the page, so it is dismissed for the session before any page script runs.
  await page.addInitScript(() => sessionStorage.setItem("ak-install-prompt-dismissed", "1"));
});

const bar = (page: Page) => page.getByRole("navigation", { name: "Main" });
const tab = (page: Page, id: string) => bar(page).locator(`[data-tab=${id}]`);
const heading = (page: Page, name: string) => page.getByRole("heading", { name, level: 1 });
const grid = (page: Page) => page.getByTestId("note-grid");
const noteSheet = (page: Page) => page.getByTestId("note-sheet");
const LOADING = "Turning the page";

/** Marks the document, so a test can tell a swap in place from a new document load: the mark is lost on a load. */
async function markDocument(page: Page): Promise<void> {
  await page.evaluate(() => { (window as unknown as { __doc: number }).__doc = 1; });
}

async function sameDocument(page: Page): Promise<boolean> {
  return page.evaluate(() => (window as unknown as { __doc?: number }).__doc === 1);
}

/** One fake note through the API of the test app (never Nextcloud), so the Notes grid has a card. The title is unique per call. */
async function seedNote(page: Page, title: string): Promise<string> {
  const unique = `${title} ${Math.random().toString(36).slice(2, 8)}`;
  const created = await page.request.post(`${app.baseUrl}/api/entries`, { data: { date: "2026-11-20", type: "note", title: unique, body: "Fake body" } });
  expect(created.status()).toBe(201);
  return unique;
}

const card = (page: Page, title: string) => grid(page).locator(".note-card", { hasText: title });

/** Watches the page for the loading line of the Notes screen. window.__loadingSeen turns true when it ever appears. */
async function watchLoadingLine(page: Page): Promise<void> {
  await page.evaluate((text) => {
    const w = window as unknown as { __loadingSeen: boolean };
    w.__loadingSeen = false;
    const look = () => { if (document.body.textContent?.includes(text)) w.__loadingSeen = true; };
    new MutationObserver(look).observe(document.body, { subtree: true, childList: true, characterData: true });
  }, LOADING);
}

test("the tabs swap in place: Notes, Account and back to the log, with the bar kept and Add never active", async ({ page }) => {
  const title = await seedNote(page, "Kitchen garden");
  await page.goto(app.baseUrl);
  await expect(heading(page, "Daily Log")).toBeVisible();
  await expect(bar(page).locator(".ak-tab")).toHaveText(["Daily log", "Collections", "Add", "Scan", "Account"]);
  const barNode = await bar(page).elementHandle();
  await markDocument(page);

  await tab(page, "notes").click();
  await expect(page).toHaveURL(`${app.baseUrl}/notes`);
  await expect(heading(page, "Collections")).toBeVisible();
  await expect(card(page, title)).toHaveCount(1);
  await expect(tab(page, "notes")).toHaveAttribute("aria-current", "page");
  await expect(tab(page, "add")).not.toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("main", { name: "Daily Log" })).toBeHidden();

  await tab(page, "account").click();
  await expect(page).toHaveURL(`${app.baseUrl}/settings`);
  await expect(heading(page, "Settings")).toBeVisible();
  await expect(page.locator("[data-section=theme]")).toBeVisible();
  await expect(tab(page, "account")).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("main", { name: "Collections" })).toBeHidden();

  await tab(page, "log").click();
  await expect(page).toHaveURL(`${app.baseUrl}/`);
  await expect(heading(page, "Daily Log")).toBeVisible();
  await expect(tab(page, "log")).toHaveAttribute("aria-current", "page");
  await expect(bar(page).locator(".ak-tab")).toHaveText(["Daily log", "Collections", "Add", "Scan", "Account"]);

  // One document the whole time, and one bar that was never replaced.
  expect(await sameDocument(page)).toBe(true);
  expect(await page.locator(".ak-tabbar").count()).toBe(1);
  expect(await barNode!.evaluate((node) => node.isConnected)).toBe(true);
});

test("Add from Notes goes to the log in place, opens the edit sheet with the title focused, and a reload leaves no sheet open", async ({ page }) => {
  await page.goto(`${app.baseUrl}/notes`);
  await markDocument(page);
  // The log is added in the background once the page is quiet; Add is tapped when it is there.
  await page.waitForFunction(() => !!document.querySelector("#log") && !!document.querySelector('script[src="/js/log/main.js"]'));
  await page.waitForTimeout(500);
  await tab(page, "add").click();
  await expect(page.getByTestId("edit-sheet")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Entry title" })).toBeFocused();
  await expect(page).toHaveURL(`${app.baseUrl}/`);
  await expect(heading(page, "Daily Log")).toBeVisible();
  await expect(page.locator(".ak-tabbar [data-tab=add]")).not.toHaveAttribute("aria-current", "page");
  expect(await sameDocument(page)).toBe(true);

  await page.reload();
  await expect(heading(page, "Daily Log")).toBeVisible();
  await expect(page.getByTestId("edit-sheet")).toBeHidden();
});

test("Back from Notes lands on the log and stays in the app, in the same document", async ({ page }) => {
  await page.goto(app.baseUrl);
  await markDocument(page);
  await tab(page, "notes").click();
  await expect(heading(page, "Collections")).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(`${app.baseUrl}/`);
  await expect(heading(page, "Daily Log")).toBeVisible();
  await expect(tab(page, "log")).toHaveAttribute("aria-current", "page");
  expect(await sameDocument(page)).toBe(true);
});

test("Notes and Account replace each other: Back from Account lands on the log, and forward returns to Account", async ({ page }) => {
  await page.goto(app.baseUrl);
  await tab(page, "notes").click();
  await tab(page, "account").click();
  await expect(heading(page, "Settings")).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(`${app.baseUrl}/`);
  await expect(heading(page, "Daily Log")).toBeVisible();

  await page.goForward();
  await expect(page).toHaveURL(`${app.baseUrl}/settings`);
  await expect(heading(page, "Settings")).toBeVisible();
  await expect(tab(page, "account")).toHaveAttribute("aria-current", "page");
});

test("an open note sheet closes on the first Back and Notes stays, the second Back returns to the log", async ({ page }) => {
  const title = await seedNote(page, "Weekend notes");
  await page.goto(app.baseUrl);
  await markDocument(page);
  await tab(page, "notes").click();
  await card(page, title).click();
  await expect(noteSheet(page)).toBeVisible();

  await page.goBack();
  await expect(noteSheet(page)).toHaveCount(0);
  await expect(page).toHaveURL(`${app.baseUrl}/notes`);
  await expect(heading(page, "Collections")).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(`${app.baseUrl}/`);
  await expect(heading(page, "Daily Log")).toBeVisible();
  expect(await sameDocument(page)).toBe(true);
});

test("an open what's new sheet in Account closes on the first Back, the second Back leaves the tab", async ({ page }) => {
  await page.goto(app.baseUrl);
  await tab(page, "account").click();
  await expect(page.locator("[data-action=open-whats-new]")).toBeVisible();
  await page.locator("[data-action=open-whats-new]").click();
  const sheet = page.locator("[data-testid=whats-new-sheet]");
  await expect(sheet).toBeVisible();

  await page.goBack();
  await expect(sheet).toHaveCount(0);
  await expect(page).toHaveURL(`${app.baseUrl}/settings`);

  await page.goBack();
  await expect(page).toHaveURL(`${app.baseUrl}/`);
  await expect(heading(page, "Daily Log")).toBeVisible();
});

/** Opens a page as the first entry of a new window (a popup has nothing before it), like the installed app started on it. */
async function openFirst(page: Page, path: string): Promise<Page> {
  await page.goto(app.baseUrl);
  const [first] = await Promise.all([
    page.waitForEvent("popup"),
    page.evaluate((url) => { window.open(url); }, `${app.baseUrl}${path}`),
  ]);
  await first.locator(".ak-tabbar").waitFor();
  // The stub for the log sits under the page, so Back does not close the window.
  expect(await first.evaluate(() => history.length)).toBe(2);
  return first;
}

for (const [path, name] of [["/settings", "Settings"], ["/notes", "Collections"]] as const) {
  test(`${path} opened first sends Back to the log instead of closing the app, without a new document`, async ({ page }) => {
    const first = await openFirst(page, path);
    await expect(heading(first, name)).toBeVisible();
    await expect(first.locator(".ak-tabbar")).toBeVisible();
    // The log is added in the background (hidden main, then its scripts). Back is pressed once that has settled.
    await first.waitForFunction(() => !!document.querySelector("#log") && !!document.querySelector('script[src="/js/log/main.js"]'));
    await first.waitForTimeout(500);
    await markDocument(first);

    await first.goBack();
    await expect(first).toHaveURL(`${app.baseUrl}/`);
    await expect(heading(first, "Daily Log")).toBeVisible();
    await expect(tab(first, "log")).toHaveAttribute("aria-current", "page");
    expect(await sameDocument(first)).toBe(true);
  });
}

test("a warm switch to Notes shows the grid and never the loading line", async ({ page }) => {
  const title = await seedNote(page, "Watering plan");
  await page.goto(app.baseUrl);
  await tab(page, "notes").click();
  await expect(card(page, title)).toHaveCount(1);
  await tab(page, "log").click();
  await expect(heading(page, "Daily Log")).toBeVisible();

  await watchLoadingLine(page);
  await tab(page, "notes").click();
  // The grid is there in the same turn as the swap: no wait is needed for it.
  await expect(card(page, title)).toHaveCount(1, { timeout: 500 });
  await tab(page, "log").click();
  await tab(page, "notes").click();
  await expect(card(page, title)).toHaveCount(1);
  expect(await page.evaluate(() => (window as unknown as { __loadingSeen: boolean }).__loadingSeen)).toBe(false);
});

test("a warm switch to an empty Notes shows the empty note, not the loading line", async ({ page }) => {
  for (const entry of ((await (await page.request.get(`${app.baseUrl}/api/entries?kind=notes`)).json()).entries as Array<{ id: string }>)) {
    await page.request.delete(`${app.baseUrl}/api/entries/${entry.id}`);
  }
  await page.goto(app.baseUrl);
  await tab(page, "notes").click();
  await expect(page.getByText("No collections yet.")).toBeVisible();
  await tab(page, "log").click();

  await watchLoadingLine(page);
  await tab(page, "notes").click();
  await expect(page.getByText("No collections yet.")).toBeVisible({ timeout: 500 });
  expect(await page.evaluate(() => (window as unknown as { __loadingSeen: boolean }).__loadingSeen)).toBe(false);
});

test("a warm switch to Account shows the theme section and a filled main", async ({ page }) => {
  await page.goto(app.baseUrl);
  await tab(page, "account").click();
  await expect(page.locator("[data-section=theme]")).toBeVisible();
  await tab(page, "log").click();

  await tab(page, "account").click();
  await expect(page.locator("[data-section=theme]")).toBeVisible({ timeout: 500 });
  await expect(page.locator("#app > *")).not.toHaveCount(0);
  await expect(page.locator("[data-action=sign-out]")).toBeVisible();
});

test("the other tabs are warmed in the background, so the first switch to Notes paints from the cache", async ({ page }) => {
  const title = await seedNote(page, "Warm note");
  await page.goto(app.baseUrl);
  // The cache of the list is filled while the log is on screen, before anybody taps Notes.
  await expect.poll(() => page.evaluate(() => localStorage.getItem("ak-swr:bujo-notes"))).toContain(title);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("ak-swr:bujo-settings"))).not.toBeNull();

  await page.route("**/api/entries?kind=notes", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await watchLoadingLine(page);
  await tab(page, "notes").click();
  // The server is slow on purpose: the grid is on screen from the cache long before it answers.
  await expect(card(page, title)).toBeVisible({ timeout: 800 });
  expect(await page.evaluate(() => (window as unknown as { __loadingSeen: boolean }).__loadingSeen)).toBe(false);
});

test("a reload of Notes paints the cached grid before the list arrives", async ({ page }) => {
  const title = await seedNote(page, "Cached card");
  await page.goto(`${app.baseUrl}/notes`);
  await expect(card(page, title)).toBeVisible();

  await page.route("**/api/entries?kind=notes", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await page.reload();
  await expect(card(page, title)).toBeVisible({ timeout: 800 });
  await expect(page.getByText(LOADING)).toHaveCount(0);
});

test("the page fades in on a switch: no slide, and no cross-document view transition", async ({ page }) => {
  await page.goto(app.baseUrl);
  await tab(page, "notes").click();
  await expect(heading(page, "Collections")).toBeVisible();
  const transform = await page.locator("#notes").evaluate((node) => getComputedStyle(node).transform);
  expect(transform).toBe("none");
  await expect(page.locator("link[href*=ak-view-transitions]")).toHaveCount(0);
});

// Last: signing out ends the session that the other tests of this file share.
test("the cached lists are forgotten on sign out", async ({ page }) => {
  await page.goto(`${app.baseUrl}/settings`);
  await expect(page.locator("[data-action=sign-out]")).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("ak-swr:bujo-settings"))).not.toBeNull();
  await page.locator("[data-action=sign-out]").click();
  await expect(page).toHaveURL(/\/signin$/);
  expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("ak-swr:")))).toEqual([]);
});
