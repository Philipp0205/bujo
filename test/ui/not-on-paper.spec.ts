import { expect, test, type Page } from "@playwright/test";
import { useBujo } from "./harness.ts";

const app = useBujo();

declare global {
  interface Window {
    __copied: string[];
  }
}

test.beforeEach(async ({ page }) => {
  await app.signIn(page);
  await page.addInitScript(() => {
    sessionStorage.setItem("ak-install-prompt-dismissed", "1");
    // An in-page clipboard: no permissions needed, and the test can read what was written.
    window.__copied = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: (text: string) => (window.__copied.push(text), Promise.resolve()), readText: () => Promise.resolve("") },
    });
  });
});

/** Every entry this spec made in its own throwaway database, so each test starts from an empty log. */
const made: string[] = [];

test.afterEach(async ({ page }) => {
  for (const id of made.splice(0)) await page.request.delete(`${app.baseUrl}/api/entries/${id}`);
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

/** Fake entries through the API with the page's session. Never a real list. A written one is also marked as on paper. */
async function seed(page: Page, entries: Seed[], written: string[] = []): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const entry of entries) {
    const response = await page.request.post(`${app.baseUrl}/api/entries`, { data: entry });
    expect(response.status()).toBe(201);
    ids[entry.title] = (await response.json()).entry.id;
    made.push(ids[entry.title]);
    if (written.includes(entry.title)) expect((await page.request.post(`${app.baseUrl}/api/entries/${ids[entry.title]}/written`)).status()).toBe(200);
  }
  return ids;
}

const row = (page: Page, title: string) => page.locator(".paper-row", { hasText: title });
const mark = (page: Page, title: string) => row(page, title).getByTestId("not-on-paper-mark");
const open = (page: Page) => page.getByTestId("not-on-paper-open");
const sheet = (page: Page) => page.getByTestId("not-on-paper-sheet");
const listed = (page: Page) => sheet(page).getByTestId("not-on-paper-row");

const FAKE: Seed[] = [
  { date: day(0), type: "task", title: "Brot kaufen", tags: ["haushalt"], time: "09:00" },
  { date: day(0), type: "event", title: "Zahnarzt" },
  { date: day(0), type: "task", title: "Schon notiert" },
  { date: day(-30), type: "task", title: "Alte Aufgabe" },
  { date: day(2), type: "note", title: "Gedanke" },
];

test("a row that is not on paper wears the mark; a row that is does not", async ({ page }) => {
  await seed(page, FAKE, ["Schon notiert"]);
  await page.goto(app.baseUrl);
  await expect(row(page, "Brot kaufen")).toHaveAttribute("data-on-paper", "false");
  await expect(mark(page, "Brot kaufen")).toHaveCount(1);
  await expect(mark(page, "Zahnarzt")).toHaveCount(1);
  await expect(row(page, "Schon notiert")).toHaveAttribute("data-on-paper", "true");
  await expect(mark(page, "Schon notiert")).toHaveCount(0);
  await expect(mark(page, "Brot kaufen")).toHaveAttribute("aria-label", "Not on paper yet");
});

test("the header button shows the count, reaching past the log window, and hides at zero", async ({ page }) => {
  await seed(page, [{ date: day(-30), type: "task", title: "Alte Aufgabe" }]);
  await page.goto(app.baseUrl);
  await expect(open(page)).toHaveText("Not on paper 1");
  await expect(row(page, "Alte Aufgabe")).toHaveCount(0);

  await open(page).click();
  await sheet(page).getByRole("button", { name: "Mark as written" }).click();
  await expect(listed(page)).toHaveCount(0);
  await expect(sheet(page).getByText("Everything is on paper.")).toBeVisible();
  await expect(page.getByTestId("not-on-paper-sub")).toHaveText("Nothing left to write down");
  await expect(sheet(page).getByTestId("copy-all")).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveCount(0);
  await expect(open(page)).toBeHidden();
});

test("the list groups entries by day, oldest day first, with each entry's pills", async ({ page }) => {
  await seed(page, FAKE, ["Schon notiert"]);
  await page.goto(app.baseUrl);
  await open(page).click();
  await expect(sheet(page)).toBeVisible();
  await expect(page.getByTestId("not-on-paper-sub")).toHaveText("4 entries to write down");
  await expect(sheet(page).getByTestId("not-on-paper-day")).toHaveCount(3);
  await expect(listed(page).locator(".paper-title")).toHaveText(["Alte Aufgabe", "Brot kaufen", "Zahnarzt", "Gedanke"]);
  await expect(listed(page).filter({ hasText: "Brot kaufen" }).locator(".pill")).toHaveText(["haushalt", "09:00"]);
  await expect(sheet(page)).not.toContainText("Schon notiert");
});

test("Copy all copies the listed entries as paper lines grouped by day", async ({ page }) => {
  await seed(page, FAKE, ["Schon notiert"]);
  await page.goto(app.baseUrl);
  await open(page).click();
  await expect(listed(page)).toHaveCount(4);
  await sheet(page).getByTestId("copy-all").click();
  const text = [
    header(day(-30)), "\u2022 Alte Aufgabe", "",
    header(day(0)), "\u2022 Brot kaufen #haushalt 09:00", "\u25cb Zahnarzt", "",
    header(day(2)), "\u2013 Gedanke",
  ].join("\n");
  expect(await page.evaluate(() => window.__copied)).toEqual([text]);
  await expect(page.getByTestId("copied-toast")).toHaveText("Copied 4");
  await expect(listed(page)).toHaveCount(4);
});

test("Mark as written removes the entry from the list, the mark from its row and one from the count", async ({ page }) => {
  await seed(page, FAKE, ["Schon notiert"]);
  await page.goto(app.baseUrl);
  await expect(open(page)).toHaveText("Not on paper 4");
  await open(page).click();
  await listed(page).filter({ hasText: "Brot kaufen" }).getByRole("button", { name: "Mark as written" }).click();
  await expect(listed(page)).toHaveCount(3);
  await expect(sheet(page)).not.toContainText("Brot kaufen");
  await expect(open(page)).toHaveText("Not on paper 3");
  await expect(mark(page, "Brot kaufen")).toHaveCount(0);
  await expect(row(page, "Brot kaufen")).toHaveAttribute("data-on-paper", "true");
  await expect(mark(page, "Zahnarzt")).toHaveCount(1);
});

test("an edit in the app puts a written entry back on the list", async ({ page }) => {
  const ids = await seed(page, FAKE, ["Schon notiert"]);
  await page.goto(app.baseUrl);
  await expect(mark(page, "Schon notiert")).toHaveCount(0);
  await page.waitForTimeout(20);
  expect((await page.request.patch(`${app.baseUrl}/api/entries/${ids["Schon notiert"]}`, { data: { time: "17:30" } })).status()).toBe(200);
  await page.reload();
  await expect(mark(page, "Schon notiert")).toHaveCount(1);
  await expect(open(page)).toHaveText("Not on paper 5");
});

test("with everything on paper the header button is hidden and no row has a mark", async ({ page }) => {
  await seed(page, [{ date: day(0), type: "task", title: "Schon notiert" }], ["Schon notiert"]);
  await page.goto(app.baseUrl);
  await expect(row(page, "Schon notiert")).toBeVisible();
  await expect(mark(page, "Schon notiert")).toHaveCount(0);
  await expect(open(page)).toBeHidden();
});

test("Back closes the list and stays in the app", async ({ page }) => {
  await seed(page, FAKE);
  await page.goto(app.baseUrl);
  await open(page).click();
  await expect(sheet(page)).toBeVisible();
  await page.goBack();
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.locator("#log")).toBeVisible();
});
