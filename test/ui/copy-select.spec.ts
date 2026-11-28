import { expect, test, type Page } from "@playwright/test";
import { PINNED_NOW, pinClock, pinnedDay, useBujo } from "./harness.ts";

const app = useBujo();

declare global {
  interface Window {
    __copied: string[];
    __copyFails: boolean;
  }
}

test.beforeEach(async ({ page }) => {
  await pinClock(page);
  await app.signIn(page);
  await page.addInitScript(() => {
    sessionStorage.setItem("ak-install-prompt-dismissed", "1");
    // An in-page clipboard: no permissions needed, and the test can read what was written.
    window.__copied = [];
    window.__copyFails = false;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (text: string) => (window.__copyFails ? Promise.reject(new Error("denied")) : (window.__copied.push(text), Promise.resolve())),
        readText: () => Promise.resolve(window.__copied[window.__copied.length - 1] ?? ""),
      },
    });
  });
});

/** A calendar day as YYYY-MM-DD in the local time zone, n days from today (the page uses the local day too). */
const day = pinnedDay;

type Seed = { date: string; type: string; title: string; tags?: string[]; time?: string };

/** Fake entries through the API with the page's session. Never a real list. Returns them in order. */
async function seed(page: Page, entries: Seed[]): Promise<Array<{ id: string }>> {
  const made: Array<{ id: string }> = [];
  for (const entry of entries) {
    const response = await page.request.post(`${app.baseUrl}/api/entries`, { data: entry });
    expect(response.status()).toBe(201);
    made.push((await response.json()).entry);
  }
  return made;
}

const row = (page: Page, title: string) => page.locator(".paper-row", { hasText: title });
const copied = (page: Page) => page.evaluate(() => window.__copied);
const bar = (page: Page) => page.getByTestId("select-bar");

/** The address of the log on the page of a day, n days from today. */
function dayUrl(offset: number): string {
  return `${app.baseUrl}/?day=${day(offset)}`;
}

/** Opens the log on the page of a day (the day a test seeded). */
async function openDay(page: Page, offset: number): Promise<void> {
  await page.goto(dayUrl(offset));
  await expect(page.getByTestId("page-body")).toHaveAttribute("data-date", day(offset));
  // Let the quiet revalidation read land, so it cannot redraw the rows under a press.
  await page.waitForLoadState("networkidle");
}

/** Freezes the page's timers. A press then lasts exactly as long as the test advances the clock, however slow the machine is. */
async function freezeClock(page: Page): Promise<void> {
  await page.clock.install({ time: PINNED_NOW });
  await page.clock.pauseAt(new Date(PINNED_NOW.getTime() + 60_000));
}

/** A long press with the mouse opens the planet menu: scroll the row to the middle (clear of the tab bar), press, hold past the hold time, release, then tap its select bubble. */
async function hold(page: Page, title: string): Promise<void> {
  await row(page, title).evaluate((node) => node.scrollIntoView({ block: "center" }));
  const box = (await row(page, title).boundingBox())!;
  await freezeClock(page);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.clock.runFor(650);
  await page.mouse.up();
  await page.getByTestId("radial-select").click();
}

test("the copy key copies the open entry as one paper line and keeps the sheet open", async ({ page }) => {
  await seed(page, [{ date: day(1), type: "task", title: "Milch kaufen", tags: ["haushalt", "Küche"], time: "09:00" }]);
  await openDay(page, 1);
  await row(page, "Milch kaufen").click();
  await expect(page.getByTestId("edit-sheet")).toBeVisible();

  await page.locator(".inline-bar [data-key=copy]").click();
  expect(await copied(page)).toEqual(["\u2022 Milch kaufen #haushalt #Küche 09:00"]);
  const toast = page.getByTestId("copied-toast");
  await expect(toast).toHaveText("Copied 1");
  await expect(toast).toHaveAttribute("role", "status");
  await expect(page.getByTestId("edit-sheet")).toBeVisible();
  await expect(toast).toHaveCount(0, { timeout: 5000 });
});

test("the copy key is hidden for a new line without a title and shows once there is one", async ({ page }) => {
  await page.goto(app.baseUrl);
  await page.locator("[data-action=add-entry]").click();
  const key = page.locator(".inline-bar [data-key=copy]");
  await expect(key).toBeHidden();
  await page.keyboard.type("Neue Zeile");
  await expect(key).toBeVisible();
  await key.click();
  expect(await copied(page)).toEqual(["\u2022 Neue Zeile"]);
});

test("a failed single copy says so in a toast", async ({ page }) => {
  await seed(page, [{ date: day(2), type: "note", title: "Nicht kopierbar" }]);
  await openDay(page, 2);
  await row(page, "Nicht kopierbar").click();
  // Both the clipboard and the textarea fallback must fail.
  await page.evaluate(() => {
    window.__copyFails = true;
    document.execCommand = () => false;
  });
  await page.locator(".inline-bar [data-key=copy]").click();
  await expect(page.getByTestId("copy-failed-toast")).toHaveText("Could not copy. Try again.");
  await expect(page.getByTestId("copied-toast")).toHaveCount(0);
  await expect(page.getByTestId("edit-sheet")).toBeVisible();
});

test("a short tap on a row still opens the edit sheet", async ({ page }) => {
  await seed(page, [{ date: day(3), type: "task", title: "Nur antippen" }]);
  await openDay(page, 3);
  await row(page, "Nur antippen").click();
  await expect(page.getByTestId("edit-sheet")).toBeVisible();
  await expect(bar(page)).toHaveCount(0);
});

test("a long press on a card opens the menu, and its select bubble starts select mode with that entry selected and no edit sheet", async ({ page }) => {
  await seed(page, [{ date: day(-1), type: "task", title: "Gehalten" }, { date: day(-1), type: "task", title: "Daneben" }]);
  await openDay(page, -1);
  await hold(page, "Gehalten");

  await expect(bar(page)).toBeVisible();
  await expect(page.getByTestId("select-count")).toHaveText("1 selected");
  await expect(row(page, "Gehalten")).toHaveAttribute("aria-selected", "true");
  await expect(row(page, "Daneben")).toHaveAttribute("aria-selected", "false");
  await expect(page.getByTestId("edit-sheet")).toBeHidden();
  await expect(page.getByRole("heading", { name: "Daily Log", level: 1 })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Main" }).locator("[data-tab=add]")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" }).locator("[data-tab=scan]")).toBeVisible();
  await expect(page.locator(`.paper-day-group[data-date="${day(-1)}"] [data-testid=select-check]`)).toHaveCount(2);
  await expect(row(page, "Gehalten").getByTestId("select-check")).toHaveAttribute("data-checked", "true");
});

test("a press that moves too far is not a long press", async ({ page }) => {
  await seed(page, [{ date: day(-2), type: "task", title: "Verwischt" }]);
  await openDay(page, -2);
  const box = (await row(page, "Verwischt").boundingBox())!;
  await freezeClock(page);
  await page.mouse.move(box.x + 40, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 40, box.y + box.height / 2 + 30, { steps: 4 });
  await page.clock.runFor(650);
  await page.mouse.up();
  await expect(bar(page)).toHaveCount(0);
});

test("a touch long press opens the menu and select starts select mode", async ({ page }) => {
  await seed(page, [{ date: day(-3), type: "task", title: "Mit dem Finger" }]);
  await openDay(page, -3);
  const target = row(page, "Mit dem Finger");
  await freezeClock(page);
  const touch = (type: string) => target.evaluate((node, kind) => {
    const rect = node.getBoundingClientRect();
    node.dispatchEvent(new PointerEvent(kind, { bubbles: true, pointerType: "touch", pointerId: 7, isPrimary: true, clientX: rect.x + 60, clientY: rect.y + 20 }));
  }, type);
  await touch("pointerdown");
  await page.clock.runFor(650);
  await touch("pointerup");
  await page.getByTestId("radial-select").click();
  await expect(bar(page)).toBeVisible();
  await expect(page.getByTestId("select-count")).toHaveText("1 selected");
});

// A page is one day, and pages do not turn while selecting, so a selection stays on one day (no day header is written then). The several-day text is covered by log-clip.test.ts.
test("select several on a day, Copy writes the paper text, shows the count and ends select mode", async ({ page }) => {
  await seed(page, [
    { date: day(4), type: "task", title: "Brot backen", tags: ["haushalt"], time: "09:00" },
    { date: day(4), type: "done", title: "Pflanzen giessen" },
    { date: day(4), type: "note", title: "Nicht dabei" },
    { date: day(5), type: "event", title: "Lunch mit Mira", tags: ["work"], time: "12:30" },
  ]);
  await openDay(page, 4);
  await hold(page, "Brot backen");
  await row(page, "Pflanzen giessen").click();
  await expect(page.getByTestId("select-count")).toHaveText("2 selected");
  await expect(page.locator(".paper-row[aria-selected=true]")).toHaveCount(2);
  await expect(page.getByTestId("edit-sheet")).toBeHidden();

  await page.locator("[data-action=select-copy]").click();
  const text = "\u2022 Brot backen #haushalt 09:00\nx Pflanzen giessen";
  expect(await copied(page)).toEqual([text]);
  await expect(page.getByTestId("copied-toast")).toHaveText("Copied 2");
  await expect(bar(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Daily Log", level: 1 })).toBeVisible();
  await expect(page.locator(".paper-row[aria-selected]")).toHaveCount(0);
});

test("a tap on a selected row unticks it, and Copy is off at zero", async ({ page }) => {
  await seed(page, [{ date: day(6), type: "task", title: "Einzig" }]);
  await openDay(page, 6);
  await hold(page, "Einzig");
  await page.waitForTimeout(400);
  await row(page, "Einzig").click();
  await expect(page.getByTestId("select-count")).toHaveText("0 selected");
  await expect(page.locator("[data-action=select-copy]")).toBeDisabled();
  await expect(bar(page)).toBeVisible();
});

test("a parent does not select its children, nor a child its parent", async ({ page }) => {
  const [parent, child] = await seed(page, [
    { date: day(-4), type: "task", title: "Eltern" },
    { date: day(-4), type: "task", title: "Kind" },
  ]);
  expect((await page.request.patch(`${app.baseUrl}/api/entries/${child.id}`, { data: { indent: 1 } })).status()).toBe(200);
  expect(parent.id).toBeTruthy();
  await openDay(page, -4);
  await hold(page, "Eltern");
  await expect(row(page, "Kind")).toHaveAttribute("aria-selected", "false");
  await row(page, "Kind").click();
  await row(page, "Eltern").click();
  await expect(row(page, "Eltern")).toHaveAttribute("aria-selected", "false");
  await expect(row(page, "Kind")).toHaveAttribute("aria-selected", "true");
  await page.locator("[data-action=select-copy]").click();
  expect(await copied(page)).toEqual(["\u2022 Kind"]);
});

test("Back while selecting leaves select mode, stays on the log and copies nothing", async ({ page }) => {
  await seed(page, [{ date: day(-5), type: "task", title: "Zurueck" }]);
  await openDay(page, -5);
  await hold(page, "Zurueck");
  await expect(bar(page)).toBeVisible();

  await page.goBack();
  await expect(bar(page)).toHaveCount(0);
  await expect(page).toHaveURL(dayUrl(-5));
  await expect(page.getByRole("heading", { name: "Daily Log", level: 1 })).toBeVisible();
  await expect(page.locator(".paper-row[aria-selected]")).toHaveCount(0);
  expect(await copied(page)).toEqual([]);
});

test("Cancel leaves select mode, clears the selection and restores the header", async ({ page }) => {
  await seed(page, [{ date: day(7), type: "task", title: "Abbrechen" }]);
  await openDay(page, 7);
  await hold(page, "Abbrechen");
  await page.locator("[data-action=select-cancel]").click();

  await expect(bar(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Daily Log", level: 1 })).toBeVisible();
  await expect(page.locator(".paper-row[aria-selected]")).toHaveCount(0);
  expect(await copied(page)).toEqual([]);
  // The next long press starts from nothing.
  await hold(page, "Abbrechen");
  await expect(page.getByTestId("select-count")).toHaveText("1 selected");
});

test("a failed Copy keeps select mode and shows the failure toast", async ({ page }) => {
  await seed(page, [{ date: day(-6), type: "task", title: "Klappt nicht" }]);
  await openDay(page, -6);
  await hold(page, "Klappt nicht");
  await page.evaluate(() => {
    window.__copyFails = true;
    document.execCommand = () => false;
  });
  await page.locator("[data-action=select-copy]").click();
  await expect(page.getByTestId("copy-failed-toast")).toBeVisible();
  await expect(bar(page)).toBeVisible();
  await expect(page.getByTestId("select-count")).toHaveText("1 selected");
});

test("Select day ticks every entry of the day of the last one toggled, nested ones too", async ({ page }) => {
  const made = await seed(page, [
    { date: day(0), type: "task", title: "Heute eins" },
    { date: day(0), type: "task", title: "Heute zwei" },
    { date: day(0), type: "note", title: "Heute drei" },
    { date: day(1), type: "task", title: "Morgen eins" },
  ]);
  expect((await page.request.patch(`${app.baseUrl}/api/entries/${made[1].id}`, { data: { indent: 1 } })).status()).toBe(200);
  await page.goto(app.baseUrl);
  await hold(page, "Heute eins");
  await page.locator("[data-action=select-day]").click();

  // Every entry of today's page is ticked (the next day is another page, so it is out of reach). Rows left by earlier tests of the file may sit on today too.
  const rows = await page.locator(".paper-row").count();
  expect(rows).toBeGreaterThanOrEqual(3);
  await expect(page.getByTestId("select-count")).toHaveText(`${rows} selected`);
  await expect(page.locator(".paper-row[aria-selected=true]")).toHaveCount(rows);
  await expect(row(page, "Heute zwei")).toHaveAttribute("aria-selected", "true");
  await expect(row(page, "Heute drei")).toHaveAttribute("aria-selected", "true");
  await expect(row(page, "Morgen eins")).toHaveCount(0);
});

test("starting select mode closes an open edit sheet first", async ({ page }) => {
  await seed(page, [{ date: day(-7 + 1), type: "task", title: "Offen" }, { date: day(-7 + 1), type: "task", title: "Dran" }]);
  await openDay(page, -6);
  await row(page, "Offen").click();
  await expect(page.getByTestId("edit-sheet")).toBeVisible();
  await hold(page, "Dran");
  await expect(bar(page)).toBeVisible();
  await expect(page.getByTestId("edit-sheet")).toBeHidden();
  await page.goBack();
  await expect(bar(page)).toHaveCount(0);
  await expect(page).toHaveURL(dayUrl(-6));
});

/** The titles the server holds for one day. */
async function stored(page: Page, offset: number): Promise<string[]> {
  const response = await page.request.get(`${app.baseUrl}/api/entries?from=${day(offset)}&to=${day(offset)}`);
  return ((await response.json()).entries as Array<{ title: string }>).map((entry) => entry.title);
}

const deleteButton = (page: Page) => page.getByTestId("select-delete");
const dialog = (page: Page) => page.getByTestId("select-delete-dialog");

test("Delete is on the bar in select mode, and off at zero", async ({ page }) => {
  await seed(page, [{ date: day(8), type: "task", title: "Loeschbar" }]);
  await openDay(page, 8);
  await hold(page, "Loeschbar");
  await expect(deleteButton(page)).toBeEnabled();
  await page.waitForTimeout(400);
  await row(page, "Loeschbar").click();
  await expect(page.getByTestId("select-count")).toHaveText("0 selected");
  await expect(deleteButton(page)).toBeDisabled();
});

test("the delete confirm shows the count, and Cancel keeps the entries and select mode", async ({ page }) => {
  await seed(page, [{ date: day(9), type: "task", title: "Bleibt eins" }, { date: day(9), type: "task", title: "Bleibt zwei" }]);
  await openDay(page, 9);
  await hold(page, "Bleibt eins");
  await row(page, "Bleibt zwei").click();
  await deleteButton(page).click();
  await expect(dialog(page)).toBeVisible();
  await expect(page.getByTestId("select-delete-title")).toHaveText("Delete 2 entries?");

  await page.getByTestId("select-delete-cancel").click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(bar(page)).toBeVisible();
  await expect(page.getByTestId("select-count")).toHaveText("2 selected");
  expect(await stored(page, 9)).toEqual(expect.arrayContaining(["Bleibt eins", "Bleibt zwei"]));

  // The veil closes it too.
  await deleteButton(page).click();
  await page.getByTestId("select-delete-overlay").click({ position: { x: 5, y: 5 } });
  await expect(dialog(page)).toHaveCount(0);
  await expect(bar(page)).toBeVisible();
});

test("confirming removes only the ticked entries, ends select mode and the server forgets them", async ({ page }) => {
  await seed(page, [
    { date: day(10), type: "task", title: "Weg eins" },
    { date: day(10), type: "note", title: "Weg zwei" },
    { date: day(10), type: "task", title: "Nachbar" },
  ]);
  await openDay(page, 10);
  await hold(page, "Weg eins");
  await row(page, "Weg zwei").click();
  await deleteButton(page).click();
  await expect(page.getByTestId("select-delete-title")).toHaveText("Delete 2 entries?");
  await page.getByTestId("select-delete-confirm").click();

  await expect(row(page, "Weg eins")).toHaveCount(0);
  await expect(row(page, "Weg zwei")).toHaveCount(0);
  await expect(row(page, "Nachbar")).toHaveCount(1);
  await expect(bar(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Daily Log", level: 1 })).toBeVisible();
  expect(await stored(page, 10)).toEqual(["Nachbar"]);
});

test("one ticked entry says entry, not entries", async ({ page }) => {
  await seed(page, [{ date: day(11), type: "task", title: "Allein" }]);
  await openDay(page, 11);
  await hold(page, "Allein");
  await deleteButton(page).click();
  await expect(page.getByTestId("select-delete-title")).toHaveText("Delete 1 entry?");
});

test("a failed delete keeps select mode, leaves the entry ticked and says so", async ({ page }) => {
  await seed(page, [{ date: day(12), type: "task", title: "Haelt fest" }]);
  await openDay(page, 12);
  await hold(page, "Haelt fest");
  await page.route("**/api/entries/*", (route) => (route.request().method() === "DELETE" ? route.fulfill({ status: 500, body: "{}" }) : route.continue()));
  await deleteButton(page).click();
  await page.getByTestId("select-delete-confirm").click();

  await expect(page.getByTestId("copy-failed-toast")).toHaveText("Could not delete 1 entry. Try again.");
  await expect(bar(page)).toBeVisible();
  await expect(row(page, "Haelt fest")).toHaveAttribute("aria-selected", "true");
  expect(await stored(page, 12)).toEqual(["Haelt fest"]);
});
