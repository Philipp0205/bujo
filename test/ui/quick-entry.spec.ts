import { expect, test, type Page } from "@playwright/test";
import { useBujo } from "./harness.ts";
import { addTab, openScan } from "./scan-helpers.ts";

const app = useBujo();

test.beforeEach(async ({ page }) => {
  await app.signIn(page);
  // The install banner would sit over the page, so it is dismissed for the session before any page script runs.
  await page.addInitScript(() => sessionStorage.setItem("ak-install-prompt-dismissed", "1"));
  // The account keeps the seen id between tests, so each one starts with the newest entry seen and no what's new sheet over the log.
  await page.request.put(`${app.baseUrl}/api/whats-new/seen`, { data: { id: "2026-11-23-paper-month-future" } });
});

const sheet = (page: Page) => page.getByTestId("edit-sheet");
const title = (page: Page) => page.getByRole("textbox", { name: "Entry title" });
const heading = (page: Page) => page.getByRole("heading", { name: "Daily Log", level: 1 });

/** Waits until the log is in the document (the router adds it in the background), so Add can swap to it in the same turn. */
async function logIsWarm(page: Page): Promise<void> {
  await page.waitForFunction(() => !!document.querySelector("#log") && !!document.querySelector('script[src="/js/log/main.js"]'));
  await page.waitForTimeout(500);
}

/** The sheet is open on a new task line with the title focused. */
async function expectNewTaskLine(page: Page): Promise<void> {
  await expect(sheet(page)).toBeVisible();
  await expect(title(page)).toBeFocused();
  await expect(title(page)).toHaveValue("");
  await expect(sheet(page).locator(".paper-edit")).toHaveAttribute("data-type", "task");
}

test("Add on the log opens the new entry sheet with the title focused, as a task", async ({ page }) => {
  await page.goto(app.baseUrl);
  await expect(heading(page)).toBeVisible();
  await expect(addTab(page)).not.toHaveAttribute("aria-current", "page");
  await addTab(page).click();
  await expectNewTaskLine(page);
  // The bar steps aside while the sheet is up, and Add is never the current page.
  await expect(page.locator(".ak-tabbar [data-tab=add]")).not.toHaveAttribute("aria-current", "page");
});

for (const [path, name] of [["/notes", "Notes"], ["/settings", "Account"]] as const) {
  test(`Add from ${name} swaps to the log in place, opens the sheet and focuses the title inside the tap`, async ({ page }) => {
    await page.goto(`${app.baseUrl}${path}`);
    await logIsWarm(page);
    await page.evaluate(() => { (window as unknown as { __doc: number }).__doc = 1; });
    await addTab(page).click();

    await expectNewTaskLine(page);
    await expect(page).toHaveURL(`${app.baseUrl}/`);
    await expect(heading(page)).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __doc?: number }).__doc === 1)).toBe(true);
  });
}

test("a tap on Add from Notes moves the focus in the same turn as the click", async ({ page }) => {
  await page.goto(`${app.baseUrl}/notes`);
  await logIsWarm(page);
  // The click handler runs the whole swap before it returns, so the title is the active element right after dispatch.
  const focused = await page.evaluate(() => {
    const button = document.querySelector<HTMLElement>('.ak-tabbar [data-tab="add"]')!;
    button.click();
    return document.activeElement?.classList.contains("paper-edit-input") ?? false;
  });
  expect(focused).toBe(true);
});

test("Add before the log is loaded still ends in an open sheet with the title focused", async ({ page }) => {
  await page.goto(`${app.baseUrl}/notes`);
  await addTab(page).click();
  await expectNewTaskLine(page);
  await expect(page).toHaveURL(`${app.baseUrl}/`);
});

test("a typed entry from Add is saved to today, and Back closes the sheet", async ({ page }) => {
  await page.goto(`${app.baseUrl}/notes`);
  await logIsWarm(page);
  await addTab(page).click();
  await expectNewTaskLine(page);
  await title(page).fill("Quick entry from Notes");
  await page.keyboard.press("Enter");
  await expect(page.locator(".paper-row", { hasText: "Quick entry from Notes" })).toHaveAttribute("data-type", "task");
  // Enter saves and closes the sheet, so the bar is back.
  await expect(sheet(page)).toBeHidden();

  await addTab(page).click();
  await expect(sheet(page)).toBeVisible();
  await page.goBack();
  await expect(sheet(page)).toBeHidden();
  await expect(heading(page)).toBeVisible();
});

test("Add opens no what's new sheet on top of the new entry", async ({ page }) => {
  await page.goto(`${app.baseUrl}/notes`);
  await page.evaluate(() => localStorage.removeItem("bujo-whats-new-seen"));
  await page.request.put(`${app.baseUrl}/api/whats-new/seen`, { data: { id: "2026-11-21-scan-gallery" } });
  await page.goto(`${app.baseUrl}/notes`);
  await logIsWarm(page);
  await addTab(page).click();
  await expectNewTaskLine(page);
  await expect(page.getByTestId("whats-new-sheet")).toHaveCount(0);
});

test("the Scan tab of the bar opens the file chooser in the same tap, from the log and from Notes", async ({ page }) => {
  await page.goto(app.baseUrl);
  await expect(heading(page)).toBeVisible();
  expect(await (await openScan(page)).element().getAttribute("id")).toBe("scan-file");

  await page.goto(`${app.baseUrl}/notes`);
  await logIsWarm(page);
  expect(await (await openScan(page)).element().getAttribute("id")).toBe("scan-file");
  await expect(page).toHaveURL(`${app.baseUrl}/`);
  await expect(page.getByTestId("scan-screen")).toBeVisible();
});
