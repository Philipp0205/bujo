import { expect, test, type Page } from "@playwright/test";
import { useBujo } from "./harness.ts";

const app = useBujo();

declare global {
  interface Window {
    __copied: string[];
    __copyFails: boolean;
  }
}

test.beforeEach(async ({ page }) => {
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
function day(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The German weekday and dd.mm. of a day, as the copied header writes it. */
function header(iso: string): string {
  const [year, month, dayOfMonth] = iso.split("-").map(Number);
  const names = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
  return `${names[new Date(Date.UTC(year, month - 1, dayOfMonth)).getUTCDay()]} ${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
}

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

/** A long press with the mouse: scroll the row to the middle (clear of the tab bar), press, hold past the hold time, release. */
async function hold(page: Page, title: string): Promise<void> {
  await row(page, title).evaluate((node) => node.scrollIntoView({ block: "center" }));
  const box = (await row(page, title).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
}

test("the copy key copies the open entry as one paper line and keeps the sheet open", async ({ page }) => {
  await seed(page, [{ date: day(1), type: "task", title: "Milch kaufen", tags: ["haushalt", "Küche"], time: "09:00" }]);
  await page.goto(app.baseUrl);
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
  await page.goto(app.baseUrl);
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
  await page.goto(app.baseUrl);
  await row(page, "Nur antippen").click();
  await expect(page.getByTestId("edit-sheet")).toBeVisible();
  await expect(bar(page)).toHaveCount(0);
});

test("a long press on a card starts select mode with that entry selected and no edit sheet", async ({ page }) => {
  await seed(page, [{ date: day(-1), type: "task", title: "Gehalten" }, { date: day(-1), type: "task", title: "Daneben" }]);
  await page.goto(app.baseUrl);
  await hold(page, "Gehalten");

  await expect(bar(page)).toBeVisible();
  await expect(page.getByTestId("select-count")).toHaveText("1 selected");
  await expect(row(page, "Gehalten")).toHaveAttribute("aria-selected", "true");
  await expect(row(page, "Daneben")).toHaveAttribute("aria-selected", "false");
  await expect(page.getByTestId("edit-sheet")).toBeHidden();
  await expect(page.getByRole("heading", { name: "Rapid Log", level: 1 })).toHaveCount(0);
  await expect(page.locator("[data-action=scan]")).toHaveCount(0);
  await expect(page.locator(`.paper-day-group[data-date="${day(-1)}"] [data-testid=select-check]`)).toHaveCount(2);
  await expect(row(page, "Gehalten").getByTestId("select-check")).toHaveAttribute("data-checked", "true");
});

test("a press that moves too far is not a long press", async ({ page }) => {
  await seed(page, [{ date: day(-2), type: "task", title: "Verwischt" }]);
  await page.goto(app.baseUrl);
  const box = (await row(page, "Verwischt").boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 40, box.y + box.height / 2 + 30, { steps: 4 });
  await page.waitForTimeout(650);
  await page.mouse.up();
  await expect(bar(page)).toHaveCount(0);
});

test("a touch long press selects too", async ({ page }) => {
  await seed(page, [{ date: day(-3), type: "task", title: "Mit dem Finger" }]);
  await page.goto(app.baseUrl);
  const target = row(page, "Mit dem Finger");
  await target.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const init = { bubbles: true, pointerType: "touch", pointerId: 7, isPrimary: true, clientX: rect.x + 60, clientY: rect.y + 20 };
    node.dispatchEvent(new PointerEvent("pointerdown", init));
    window.setTimeout(() => node.dispatchEvent(new PointerEvent("pointerup", init)), 650);
  });
  await expect(bar(page)).toBeVisible();
  await expect(page.getByTestId("select-count")).toHaveText("1 selected");
});

test("select several across two days, Copy writes the grouped text, shows the count and ends select mode", async ({ page }) => {
  await seed(page, [
    { date: day(4), type: "task", title: "Brot backen", tags: ["haushalt"], time: "09:00" },
    { date: day(4), type: "done", title: "Pflanzen giessen" },
    { date: day(4), type: "note", title: "Nicht dabei" },
    { date: day(5), type: "event", title: "Lunch mit Mira", tags: ["work"], time: "12:30" },
  ]);
  await page.goto(app.baseUrl);
  await hold(page, "Lunch mit Mira");
  await row(page, "Pflanzen giessen").click();
  await row(page, "Brot backen").click();
  await expect(page.getByTestId("select-count")).toHaveText("3 selected");
  await expect(page.locator(".paper-row[aria-selected=true]")).toHaveCount(3);
  await expect(page.getByTestId("edit-sheet")).toBeHidden();

  await page.locator("[data-action=select-copy]").click();
  const text = `${header(day(4))}\n\u2022 Brot backen #haushalt 09:00\nx Pflanzen giessen\n\n${header(day(5))}\n\u25cb Lunch mit Mira #work 12:30`;
  expect(await copied(page)).toEqual([text]);
  await expect(page.getByTestId("copied-toast")).toHaveText("Copied 3");
  await expect(bar(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Rapid Log", level: 1 })).toBeVisible();
  await expect(page.locator(".paper-row[aria-selected]")).toHaveCount(0);
});

test("a tap on a selected row unticks it, and Copy is off at zero", async ({ page }) => {
  await seed(page, [{ date: day(6), type: "task", title: "Einzig" }]);
  await page.goto(app.baseUrl);
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
  await page.goto(app.baseUrl);
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
  await page.goto(app.baseUrl);
  await hold(page, "Zurueck");
  await expect(bar(page)).toBeVisible();

  await page.goBack();
  await expect(bar(page)).toHaveCount(0);
  await expect(page).toHaveURL(`${app.baseUrl}/`);
  await expect(page.getByRole("heading", { name: "Rapid Log", level: 1 })).toBeVisible();
  await expect(page.locator(".paper-row[aria-selected]")).toHaveCount(0);
  expect(await copied(page)).toEqual([]);
});

test("Cancel leaves select mode, clears the selection and restores the header", async ({ page }) => {
  await seed(page, [{ date: day(7), type: "task", title: "Abbrechen" }]);
  await page.goto(app.baseUrl);
  await hold(page, "Abbrechen");
  await page.locator("[data-action=select-cancel]").click();

  await expect(bar(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Scan a page" })).toBeVisible();
  await expect(page.locator(".paper-row[aria-selected]")).toHaveCount(0);
  expect(await copied(page)).toEqual([]);
  // The next long press starts from nothing.
  await hold(page, "Abbrechen");
  await expect(page.getByTestId("select-count")).toHaveText("1 selected");
});

test("a failed Copy keeps select mode and shows the failure toast", async ({ page }) => {
  await seed(page, [{ date: day(-6), type: "task", title: "Klappt nicht" }]);
  await page.goto(app.baseUrl);
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

  await expect(page.getByTestId("select-count")).toHaveText("3 selected");
  await expect(row(page, "Heute zwei")).toHaveAttribute("aria-selected", "true");
  await expect(row(page, "Heute drei")).toHaveAttribute("aria-selected", "true");
  await expect(row(page, "Morgen eins")).toHaveAttribute("aria-selected", "false");
});

test("starting select mode closes an open edit sheet first", async ({ page }) => {
  await seed(page, [{ date: day(-7 + 1), type: "task", title: "Offen" }, { date: day(-7 + 1), type: "task", title: "Dran" }]);
  await page.goto(app.baseUrl);
  await row(page, "Offen").click();
  await expect(page.getByTestId("edit-sheet")).toBeVisible();
  await hold(page, "Dran");
  await expect(bar(page)).toBeVisible();
  await expect(page.getByTestId("edit-sheet")).toBeHidden();
  await page.goBack();
  await expect(bar(page)).toHaveCount(0);
  await expect(page).toHaveURL(`${app.baseUrl}/`);
});
