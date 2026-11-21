import { expect, test, type Page } from "@playwright/test";
import { openDetails, useBujo } from "./harness.ts";

const app = useBujo();

test.beforeEach(async ({ page }) => {
  await app.signIn(page);
  // The install banner would sit over the sheets, so it is dismissed for the session before any page script runs.
  await page.addInitScript(() => sessionStorage.setItem("ak-install-prompt-dismissed", "1"));
});

/** A calendar day as YYYY-MM-DD in the local time zone, n days from today (the page uses the local day too). */
function day(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** One note through the API, so nothing is pushed anywhere. Each test uses its own day. */
async function seed(page: Page, offset: number, title: string): Promise<void> {
  const response = await page.request.post(`${app.baseUrl}/api/entries`, { data: { date: day(offset), type: "note", title } });
  expect(response.status()).toBe(201);
}

/** Replaces window.visualViewport with a fake that starts at the full height and is moved by window.__setViewportHeight(h). */
async function fakeViewport(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const listeners: Record<string, Array<(event: Event) => void>> = { resize: [], scroll: [] };
    const fake = {
      height: window.innerHeight,
      width: window.innerWidth,
      offsetTop: 0,
      offsetLeft: 0,
      pageTop: 0,
      pageLeft: 0,
      scale: 1,
      addEventListener: (type: string, fn: (event: Event) => void) => { (listeners[type] ??= []).push(fn); },
      removeEventListener: () => undefined,
    };
    Object.defineProperty(window, "visualViewport", { value: fake, configurable: true });
    (window as unknown as { __setViewportHeight: (h: number) => void }).__setViewportHeight = (height: number) => {
      fake.height = height;
      listeners.resize.forEach((fn) => fn(new Event("resize")));
    };
  });
}

/** Moves the fake visual viewport to a height below the layout viewport (the keyboard) or back to the full one. */
async function setKeyboard(page: Page, gap: number): Promise<void> {
  await page.evaluate((px) => (window as unknown as { __setViewportHeight: (h: number) => void }).__setViewportHeight(window.innerHeight - px), gap);
}

const log = (page: Page) => page.getByRole("main", { name: "Rapid Log" });
const row = (page: Page, title: string) => page.locator(".paper-row", { hasText: title });

test("Back closes the edit sheet and stays on the log", async ({ page }) => {
  await seed(page, 1, "Eins");
  await page.goto(app.baseUrl);
  await row(page, "Eins").click();
  await expect(page.getByTestId("edit-sheet")).toBeVisible();

  await page.goBack();
  await expect(page.getByTestId("edit-sheet")).toBeHidden();
  await expect(page).toHaveURL(`${app.baseUrl}/`);
  await expect(log(page)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Rapid Log" })).toBeVisible();
});

test("Back on the edit sheet saves a changed line like Escape does", async ({ page }) => {
  await seed(page, 2, "Zwei");
  await page.goto(app.baseUrl);
  await row(page, "Zwei").click();
  await page.locator(".paper-edit-input").fill("Zwei geaendert");

  await page.goBack();
  await expect(page.getByTestId("edit-sheet")).toBeHidden();
  await expect(row(page, "Zwei geaendert")).toBeVisible();
  const stored = await page.request.get(`${app.baseUrl}/api/entries?from=${day(2)}&to=${day(2)}`);
  expect(((await stored.json()).entries as Array<{ title: string }>).map((entry) => entry.title)).toEqual(["Zwei geaendert"]);
});

test("Back drops an empty new line", async ({ page }) => {
  await page.goto(app.baseUrl);
  await page.locator("[data-action=add-entry]").click();
  await expect(page.getByTestId("edit-sheet")).toBeVisible();

  await page.goBack();
  await expect(page.getByTestId("edit-sheet")).toBeHidden();
  await expect(log(page)).toBeVisible();
});

test("Back closes the details sheet and stays on the log", async ({ page }) => {
  await seed(page, 3, "Drei");
  await page.goto(app.baseUrl);
  await openDetails(page, "Drei");

  await page.goBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(`${app.baseUrl}/`);
  await expect(log(page)).toBeVisible();
});

test("Back closes a bar popover first and leaves the sheet open", async ({ page }) => {
  await seed(page, 4, "Vier");
  await page.goto(app.baseUrl);
  await row(page, "Vier").click();
  await page.locator(".inline-bar [data-key=tag]").click();
  await expect(page.locator(".inline-pop")).toBeVisible();

  await page.goBack();
  await expect(page.locator(".inline-pop")).toHaveCount(0);
  await expect(page.getByTestId("edit-sheet")).toBeVisible();

  await page.goBack();
  await expect(page.getByTestId("edit-sheet")).toBeHidden();
  await expect(log(page)).toBeVisible();
});

test("closing the sheet inside the app leaves no extra history entry", async ({ page }) => {
  await seed(page, 5, "Fuenf");
  await page.goto(`${app.baseUrl}/settings`);
  await page.getByRole("link", { name: "Rapid Log" }).click();
  await expect(log(page)).toBeVisible();
  await row(page, "Fuenf").click();
  await expect(page.getByTestId("edit-sheet")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("edit-sheet")).toBeHidden();
  // The kit drops the sheet's entry with history.go(-1). Wait until that has landed.
  await expect.poll(() => page.evaluate(() => history.state)).toBeNull();
  // One Back reaches the page before the log, so the closed sheet left no entry behind.
  await page.goBack();
  await expect(page).toHaveURL(`${app.baseUrl}/settings`);
});

test("Back from settings returns to the log", async ({ page }) => {
  await page.goto(app.baseUrl);
  await page.getByRole("button", { name: "Account" }).click();
  await expect(page).toHaveURL(`${app.baseUrl}/settings`);
  await expect(page.locator("[data-action=open-whats-new]")).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(`${app.baseUrl}/`);
  await expect(log(page)).toBeVisible();
});

test("settings opened first sends Back to the log", async ({ page }) => {
  await page.goto(app.baseUrl);
  // A popup has no earlier history entry, like the installed app started on this page.
  const [first] = await Promise.all([
    page.waitForEvent("popup"),
    page.evaluate((url) => { window.open(url); }, `${app.baseUrl}/settings`),
  ]);
  await expect(first.locator("[data-action=open-whats-new]")).toBeVisible();
  expect(await first.evaluate(() => history.length)).toBe(2);

  await first.goBack();
  await expect(first).toHaveURL(`${app.baseUrl}/`);
  await expect(log(first)).toBeVisible();
});

test("Back closes the scan camera and stays on the log", async ({ page }) => {
  await page.goto(app.baseUrl);
  await page.getByRole("button", { name: "Scan a page" }).click();
  await expect(page.getByTestId("scan-screen")).toBeVisible();

  await page.goBack();
  await expect(page.getByTestId("scan-screen")).toHaveCount(0);
  await expect(page).toHaveURL(`${app.baseUrl}/`);
  await expect(log(page)).toBeVisible();
});

test("the bar hides when the keyboard closes, the sheet stays, and Back then closes the sheet", async ({ page }) => {
  await seed(page, 6, "Sechs");
  await fakeViewport(page);
  await page.goto(app.baseUrl);
  await row(page, "Sechs").click();
  const sheet = page.getByTestId("edit-sheet");
  await expect(sheet).toBeVisible();
  await expect(page.locator(".inline-bar")).toBeVisible();

  await setKeyboard(page, 320);
  await expect(page.locator(".inline-bar")).toBeVisible();
  await expect(sheet).toBeVisible();

  await setKeyboard(page, 0);
  await expect(page.locator(".inline-bar")).toBeHidden();
  await expect(sheet).toBeVisible();

  await setKeyboard(page, 320);
  await expect(page.locator(".inline-bar")).toBeVisible();
  await setKeyboard(page, 0);
  await expect(page.locator(".inline-bar")).toBeHidden();

  await page.goBack();
  await expect(sheet).toBeHidden();
  await expect(log(page)).toBeVisible();
});

test("without a keyboard the bar stays, even when the viewport events fire", async ({ page }) => {
  await seed(page, 7, "Sieben");
  await fakeViewport(page);
  await page.goto(app.baseUrl);
  await row(page, "Sieben").click();
  await setKeyboard(page, 0);
  await setKeyboard(page, 40);
  await setKeyboard(page, 0);
  await expect(page.locator(".inline-bar")).toBeVisible();
});

test("a tap on the backdrop still saves and closes the sheet with the keyboard gone", async ({ page }) => {
  await seed(page, -2, "Acht");
  await fakeViewport(page);
  await page.goto(app.baseUrl);
  await row(page, "Acht").click();
  await setKeyboard(page, 320);
  await setKeyboard(page, 0);
  await expect(page.locator(".inline-bar")).toBeHidden();

  await page.getByRole("heading", { name: "Rapid Log" }).click();
  await expect(page.getByTestId("edit-sheet")).toBeHidden();
});
