import { expect, test, type Page } from "@playwright/test";
import { openDetails, pinClock, pinnedDay, useBujo } from "./harness.ts";
import { openScan } from "./scan-helpers.ts";

const app = useBujo();

test.beforeEach(async ({ page }) => {
  await pinClock(page);
  await app.signIn(page);
  // The install banner would sit over the sheets, so it is dismissed for the session before any page script runs.
  await page.addInitScript(() => sessionStorage.setItem("ak-install-prompt-dismissed", "1"));
});

/** A calendar day as YYYY-MM-DD in the local time zone, n days from today (the page uses the local day too). */
const day = pinnedDay;

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

const log = (page: Page) => page.getByRole("main", { name: "Daily Log" });
const row = (page: Page, title: string) => page.locator(".paper-row", { hasText: title });

/** The address of the log on the page of a day, n days from today. The log keeps ?day= in its address. */
function dayUrl(offset: number): string {
  return `${app.baseUrl}/?day=${day(offset)}`;
}

/** Opens the log on the page of a day (the day a test seeded). */
async function openDay(page: Page, offset: number): Promise<void> {
  await page.goto(dayUrl(offset));
  await expect(page.getByTestId("page-body")).toHaveAttribute("data-date", day(offset));
}

test("Back closes the edit sheet and stays on the log", async ({ page }) => {
  await seed(page, 1, "Eins");
  await openDay(page, 1);
  const tabs = page.getByRole("navigation", { name: "Main" });
  await expect(tabs).toBeVisible();
  await row(page, "Eins").click();
  await expect(page.getByTestId("edit-sheet")).toBeVisible();
  await expect(tabs).toBeHidden();

  await page.goBack();
  await expect(page.getByTestId("edit-sheet")).toBeHidden();
  await expect(tabs).toBeVisible();
  await expect(page).toHaveURL(dayUrl(1));
  await expect(log(page)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Daily Log" })).toBeVisible();
});

test("Back on the edit sheet saves a changed line like Escape does", async ({ page }) => {
  await seed(page, 2, "Zwei");
  await openDay(page, 2);
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
  await openDay(page, 3);
  await openDetails(page, "Drei");

  await page.goBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(dayUrl(3));
  await expect(log(page)).toBeVisible();
});

test("Back closes a bar popover first and leaves the sheet open", async ({ page }) => {
  await seed(page, 4, "Vier");
  await openDay(page, 4);
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
  await openDay(page, 5);
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
  await openScan(page);
  await expect(page.getByTestId("scan-screen")).toBeVisible();

  await page.goBack();
  await expect(page.getByTestId("scan-screen")).toHaveCount(0);
  await expect(page).toHaveURL(`${app.baseUrl}/`);
  await expect(log(page)).toBeVisible();
});

/** The titles the API holds on one day. */
async function storedTitles(page: Page, offset: number): Promise<string[]> {
  const stored = await page.request.get(`${app.baseUrl}/api/entries?from=${day(offset)}&to=${day(offset)}`);
  return ((await stored.json()).entries as Array<{ title: string }>).map((entry) => entry.title);
}

/** Settings first, then the log on a day, so there is a real page before the log to go back to. */
async function openLogFromSettings(page: Page, title: string, offset: number): Promise<void> {
  await page.goto(`${app.baseUrl}/settings`);
  await openDay(page, offset);
  await expect(log(page)).toBeVisible();
  await row(page, title).click();
  await expect(page.getByTestId("edit-sheet")).toBeVisible();
}

test("Back after the keyboard was up closes the sheet and the keyboard together and saves", async ({ page }) => {
  await seed(page, 6, "Sechs");
  await fakeViewport(page);
  await openLogFromSettings(page, "Sechs", 6);
  const sheet = page.getByTestId("edit-sheet");
  await setKeyboard(page, 320);
  await expect(page.locator(".inline-bar")).toBeVisible();
  await expect(sheet).toBeVisible();
  await page.locator(".paper-edit-input").fill("Sechs geaendert");

  await page.goBack();
  await expect(sheet).toBeHidden();
  await expect(page.locator(".paper-edit-input")).not.toBeFocused();
  await expect(row(page, "Sechs geaendert")).toBeVisible();
  expect(await storedTitles(page, 6)).toEqual(["Sechs geaendert"]);

  await page.goBack();
  await expect(page).toHaveURL(`${app.baseUrl}/settings`);
});

test("the Android Back that only dismisses the keyboard closes the sheet and saves", async ({ page }) => {
  await seed(page, -1, "Acht");
  await fakeViewport(page);
  await openLogFromSettings(page, "Acht", -1);
  const sheet = page.getByTestId("edit-sheet");
  await setKeyboard(page, 320);
  await expect(sheet).toBeVisible();
  await page.locator(".paper-edit-input").fill("Acht geaendert");

  await setKeyboard(page, 0);
  await expect(sheet).toBeHidden();
  await expect(page.locator(".paper-edit-input")).not.toBeFocused();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  await expect(row(page, "Acht geaendert")).toBeVisible();
  expect(await storedTitles(page, -1)).toEqual(["Acht geaendert"]);

  // The kit drops the sheet's entry with history.go(-1). Wait until that has landed, then Back is a normal page back.
  await expect.poll(() => page.evaluate(() => history.state)).toBeNull();
  await page.goBack();
  await expect(page).toHaveURL(`${app.baseUrl}/settings`);
});

test("a keyboard dismissal with a popover open closes the popover first and keeps the sheet", async ({ page }) => {
  await seed(page, -3, "Neun");
  await fakeViewport(page);
  await openDay(page, -3);
  await row(page, "Neun").click();
  await setKeyboard(page, 320);
  await page.locator(".inline-bar [data-key=tag]").click();
  await expect(page.locator(".inline-pop")).toBeVisible();

  await setKeyboard(page, 0);
  await expect(page.locator(".inline-pop")).toHaveCount(0);
  await expect(page.getByTestId("edit-sheet")).toBeVisible();
});

test("the Time key opens the picker on the first tap, and the keyboard it hides does not close the popover or the sheet", async ({ page }) => {
  await seed(page, -4, "Elf");
  await fakeViewport(page);
  await page.addInitScript(() => {
    (window as unknown as { __pickers: number }).__pickers = 0;
    HTMLInputElement.prototype.showPicker = function () { (window as unknown as { __pickers: number }).__pickers += 1; };
  });
  await openDay(page, -4);
  await row(page, "Elf").click();
  await setKeyboard(page, 320);

  await page.locator(".inline-bar [data-key=time]").click();
  const input = page.locator('.inline-pop input[name="time"]');
  await expect(input).toBeFocused();
  expect(await page.evaluate(() => (window as unknown as { __pickers: number }).__pickers)).toBe(1);

  // The picker takes the place of the soft keyboard: it goes away, and the popover and the sheet stay.
  await setKeyboard(page, 0);
  await expect(input).toBeVisible();
  await expect(page.getByTestId("edit-sheet")).toBeVisible();
  await input.fill("08:15");
  await expect(page.locator(".sheet-chips .pill")).toHaveText(["08:15"]);
});

test("without a picker field in focus, a dismissed keyboard still closes an open popover first", async ({ page }) => {
  await seed(page, -5, "Zwoelf");
  await fakeViewport(page);
  await openDay(page, -5);
  await row(page, "Zwoelf").click();
  await setKeyboard(page, 320);
  await page.locator(".inline-bar [data-key=date]").click();
  await expect(page.locator('.inline-pop input[name="date"]')).toBeVisible();
  await page.locator(".paper-edit-input").focus();

  await setKeyboard(page, 0);
  await expect(page.locator(".inline-pop")).toHaveCount(0);
  await expect(page.getByTestId("edit-sheet")).toBeVisible();
});

test("the Android keyboard dismissal drops an empty new line", async ({ page }) => {
  await fakeViewport(page);
  await page.goto(app.baseUrl);
  await page.locator("[data-action=add-entry]").click();
  await setKeyboard(page, 320);
  await expect(page.getByTestId("edit-sheet")).toBeVisible();

  await setKeyboard(page, 0);
  await expect(page.getByTestId("edit-sheet")).toBeHidden();
  await expect(log(page)).toBeVisible();
});

test("without a keyboard the bar stays, even when the viewport events fire", async ({ page }) => {
  await seed(page, 7, "Sieben");
  await fakeViewport(page);
  await openDay(page, 7);
  await row(page, "Sieben").click();
  await setKeyboard(page, 0);
  await setKeyboard(page, 40);
  await setKeyboard(page, 0);
  await expect(page.locator(".inline-bar")).toBeVisible();
  await expect(page.getByTestId("edit-sheet")).toBeVisible();
});

test("a tap on the backdrop still saves and closes the sheet while the keyboard is up", async ({ page }) => {
  await seed(page, -2, "Zehn");
  await fakeViewport(page);
  await openDay(page, -2);
  await row(page, "Zehn").click();
  await setKeyboard(page, 320);
  await page.locator(".paper-edit-input").fill("Zehn geaendert");

  await page.getByRole("heading", { name: "Daily Log" }).click();
  await expect(page.getByTestId("edit-sheet")).toBeHidden();
  expect(await storedTitles(page, -2)).toEqual(["Zehn geaendert"]);
});
