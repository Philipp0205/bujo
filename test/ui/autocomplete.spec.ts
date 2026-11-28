import { expect, test, type Page } from "@playwright/test";
import { PINNED_NOW, pinClock, useBujo } from "./harness.ts";

const app = useBujo();

test.beforeEach(async ({ page }) => {
  await pinClock(page);
  await app.signIn(page);
});

/** A calendar day as a Date in the local time zone, n days from the pinned today (the page uses the local day too). */
function dateOf(offset: number): Date {
  const date = new Date(PINNED_NOW);
  date.setDate(date.getDate() + offset);
  return date;
}

const pad = (n: number) => String(n).padStart(2, "0");
const day = (offset: number) => {
  const date = dateOf(offset);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
/** The pill text of a day that is not the home day: DD.MM. */
const pillOf = (offset: number) => `${pad(dateOf(offset).getDate())}.${pad(dateOf(offset).getMonth() + 1)}`;
/** The label of a date suggestion: weekday, DD.MM. and the year when it is not this year. */
function labelOf(offset: number): string {
  const date = dateOf(offset);
  const weekday = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"][date.getDay()];
  const year = date.getFullYear() === PINNED_NOW.getFullYear() ? "" : String(date.getFullYear());
  return `${weekday} ${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${year}`;
}
/** Days from today to the next day with this weekday (0 = Sunday), today included. */
const untilWeekday = (weekday: number) => (weekday - PINNED_NOW.getDay() + 7) % 7;

type Entry = { id: string; date: string; title: string; tags: string[]; time: string | null };

/** The entries of one day as the API holds them. */
async function stored(page: Page, offset: number): Promise<Entry[]> {
  const response = await page.request.get(`${app.baseUrl}/api/entries?from=${day(offset)}&to=${day(offset)}`);
  return (await response.json()).entries as Entry[];
}

/** Fake entries through the API, so the tag pool has something to suggest. */
async function seedTagged(page: Page, title: string, tags: string[]): Promise<void> {
  const response = await page.request.post(`${app.baseUrl}/api/entries`, { data: { date: day(0), type: "note", title, tags } });
  expect(response.status()).toBe(201);
}

const strip = (page: Page) => page.getByTestId("suggest-strip");
const labels = (page: Page) => strip(page).locator(".suggest-opt .suggest-label");
const line = (page: Page) => page.locator(".paper-line .paper-edit-input");
const chips = (page: Page) => page.locator(".sheet-chips .pill");

/** Opens a new line on today and focuses its title. */
async function newLine(page: Page): Promise<void> {
  await page.goto(app.baseUrl);
  await page.locator("[data-action=add-entry]").click();
  await expect(line(page)).toBeFocused();
}

test("a # offers the tags in use, a tap puts the tag on the line as a pill and keeps the keyboard", async ({ page }) => {
  await seedTagged(page, "Zaun gestrichen", ["Gartenzaun", "Gartenbau"]);
  await newLine(page);
  await page.keyboard.type("Rechnung #gartenz");

  await expect(strip(page)).toBeVisible();
  await expect(labels(page).first()).toHaveText("#Gartenzaun");
  await strip(page).locator(".suggest-opt", { hasText: "#Gartenzaun" }).click();

  await expect(line(page)).toHaveValue("Rechnung ");
  await expect(line(page)).toBeFocused();
  await expect(chips(page)).toHaveText(["Gartenzaun"]);
  await expect(strip(page)).toBeHidden();

  await page.keyboard.press("Enter");
  await expect.poll(async () => (await stored(page, 0)).find((entry) => entry.title === "Rechnung")?.tags).toEqual(["Gartenzaun"]);
});

test("the strip finds a tag across umlaut spellings and offers a new word last", async ({ page }) => {
  await seedTagged(page, "Kuchen gebacken", ["Küchenplan"]);
  await newLine(page);
  await page.keyboard.type("Einkauf #kuechenp");
  await expect(labels(page).first()).toHaveText("#Küchenplan");
  await expect(strip(page).locator('.suggest-opt[data-kind="new"]')).toHaveCount(1);
  await expect(strip(page).locator(".suggest-opt").last()).toHaveAttribute("data-kind", "new");

  await page.keyboard.press("Control+A");
  await page.keyboard.type("Einkauf #brandneuertag");
  await expect(strip(page).locator(".suggest-opt")).toHaveCount(1);
  await strip(page).locator('.suggest-opt[data-kind="new"]').click();
  await expect(chips(page)).toHaveText(["brandneuertag"]);
  await expect(line(page)).toHaveValue("Einkauf ");
});

test("a tag the line already has is not offered again, and a second tag is added next to the first", async ({ page }) => {
  await seedTagged(page, "Zwei Tags", ["Wochenplanung", "Wochenmarkt"]);
  await newLine(page);
  await page.keyboard.type("Obst #wochenm");
  await strip(page).locator(".suggest-opt", { hasText: "#Wochenmarkt" }).click();
  await page.keyboard.type("#wochen");
  await expect(strip(page).locator(".suggest-opt", { hasText: "#Wochenmarkt" })).toHaveCount(0);
  await strip(page).locator(".suggest-opt", { hasText: "#Wochenplanung" }).click();
  await expect(chips(page)).toHaveText(["Wochenmarkt", "Wochenplanung"]);
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await stored(page, 0)).find((entry) => entry.title === "Obst")?.tags).toEqual(["Wochenmarkt", "Wochenplanung"]);
});

test("arrow keys highlight an option and Enter takes it, while Enter with none highlighted saves the line", async ({ page }) => {
  await seedTagged(page, "Pfeil", ["Pfeiltest"]);
  await newLine(page);
  await page.keyboard.type("Taste #pfeilt");
  await expect(strip(page)).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(strip(page).locator('.suggest-opt[aria-selected="true"]')).toHaveText(/#Pfeiltest/);
  await page.keyboard.press("Enter");
  await expect(chips(page)).toHaveText(["Pfeiltest"]);
  expect((await stored(page, 0)).some((entry) => entry.title === "Taste")).toBe(false);

  await page.keyboard.type("#pfeilt");
  await expect(strip(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".edit-sheet")).toBeHidden();
});

test("an @ offers days, a tap puts the day on the line as a pill, and the entry lands on that day", async ({ page }) => {
  const ahead = untilWeekday(1);
  await newLine(page);
  await page.keyboard.type("Zahnarzt @mo");

  await expect(strip(page)).toBeVisible();
  await expect(labels(page).first()).toHaveText(labelOf(ahead));
  await expect(strip(page).locator(".suggest-hint").first()).toHaveText("Montag");
  // When tomorrow is Monday, @mo has only that one day, not a second "tomorrow" row.
  if (ahead !== 1) await expect(labels(page).nth(1)).toHaveText(labelOf(1));
  await labels(page).first().click();

  await expect(line(page)).toHaveValue("Zahnarzt ");
  await expect(strip(page)).toBeHidden();
  if (ahead === 0) await expect(chips(page)).toHaveCount(0);
  else await expect(chips(page)).toHaveText([pillOf(ahead)]);

  await page.keyboard.press("Enter");
  await expect.poll(async () => (await stored(page, ahead)).some((entry) => entry.title === "Zahnarzt")).toBe(true);
});

test("a written @morgen becomes the day of tomorrow, and a bare @ lists today first", async ({ page }) => {
  await newLine(page);
  await page.keyboard.type("Mira anrufen @");
  await expect(labels(page).first()).toHaveText(labelOf(0));
  await expect(strip(page).locator(".suggest-hint").first()).toHaveText("heute");
  await page.keyboard.type("morgen ");

  await expect(line(page)).toHaveValue("Mira anrufen ");
  await expect(chips(page)).toHaveText([pillOf(1)]);
  await expect(strip(page)).toBeHidden();
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await stored(page, 1)).some((entry) => entry.title === "Mira anrufen")).toBe(true);
});

test("a numeric day is offered in the canonical form", async ({ page }) => {
  await newLine(page);
  await page.keyboard.type("Frist @");
  const target = dateOf(3);
  await page.keyboard.type(`${target.getDate()}.${target.getMonth() + 1}`);
  await expect(strip(page).locator(".suggest-opt")).toHaveCount(1);
  await expect(labels(page).first()).toHaveText(labelOf(3));
  await labels(page).first().click();
  await expect(chips(page)).toHaveText([pillOf(3)]);
});

test("the tag popover searches, forgives umlaut spellings and closes after a tag is picked", async ({ page }) => {
  await seedTagged(page, "Popover Saat", ["Gemüsebeet", "Gemüsegarten", "Rosenbeet"]);
  await newLine(page);
  await page.keyboard.type("Beete umgraben");

  await page.locator(".bar-key[data-key=tag]").click();
  const search = page.locator('.inline-pop input[name="tag"]');
  const pop = page.locator(".inline-pop");
  await expect(search).toBeFocused();
  await search.fill("gemuese");
  await expect(pop.locator(".pop-tag:not(.pop-tag-new) .pop-tag-name")).toHaveText(["#Gemüsebeet", "#Gemüsegarten"]);

  await pop.locator('.pop-tag[data-tag="Gemüsebeet"]').click();
  await expect(chips(page)).toHaveText(["Gemüsebeet"]);
  await expect(pop).toHaveCount(0);

  await page.locator(".bar-key[data-key=tag]").click();
  await expect(search).toBeFocused();
  await search.fill("gemuese");
  await pop.locator('.pop-tag[data-tag="Gemüsegarten"]').click();
  await expect(chips(page)).toHaveText(["Gemüsebeet", "Gemüsegarten"]);
  await expect(pop).toHaveCount(0);

  await page.locator(".bar-key[data-key=tag]").click();
  await pop.locator('.pop-tag[data-tag="Gemüsegarten"]').click();
  await expect(chips(page)).toHaveText(["Gemüsebeet"]);
  await expect(pop).toHaveCount(0);

  await page.locator(".bar-key[data-key=tag]").click();
  await search.fill("rosenbeet");
  await page.keyboard.press("Enter");
  await expect(chips(page)).toHaveText(["Gemüsebeet", "Rosenbeet"]);
  await expect(pop).toHaveCount(0);

  await page.locator(".bar-key[data-key=tag]").click();
  await search.fill("spaltnagelneu");
  await expect(pop.locator(".pop-tag-new")).toHaveText(/#spaltnagelneu/);
  await page.keyboard.press("Enter");
  await expect(chips(page)).toHaveText(["Gemüsebeet", "Rosenbeet", "spaltnagelneu"]);
  await expect(pop).toHaveCount(0);

  await page.keyboard.press("Enter");
  await expect.poll(async () => (await stored(page, 0)).find((entry) => entry.title === "Beete umgraben")?.tags).toEqual(["Gemüsebeet", "Rosenbeet", "spaltnagelneu"]);
});

test("Clear in the tag popover takes every tag off the line", async ({ page }) => {
  await newLine(page);
  await page.keyboard.type("Aufräumen #eins #zwei ");
  await expect(chips(page)).toHaveText(["eins", "zwei"]);
  await page.locator(".bar-key[data-key=tag]").click();
  await page.locator(".inline-pop .pop-clear").click();
  await expect(chips(page)).toHaveCount(0);
  await expect(page.locator(".inline-pop")).toBeVisible();
});

test("several tags wrap inside the row and stay in order after saving", async ({ page }) => {
  await newLine(page);
  await page.keyboard.type("Wochenende planen #einkaufsliste #wochenablauf #gartenarbeit #familienfeier #steuerunterlagen #reise ");
  await expect(chips(page)).toHaveCount(6);
  await page.keyboard.press("Enter");

  const saved = page.locator(".paper-row[data-id]", { hasText: "Wochenende planen" });
  await expect(saved.locator(".pill")).toHaveText(["einkaufsliste", "wochenablauf", "gartenarbeit", "familienfeier", "steuerunterlagen", "reise"]);
  const box = (await saved.boundingBox())!;
  for (const pill of await saved.locator(".pill").all()) {
    const rect = (await pill.boundingBox())!;
    expect(rect.x).toBeGreaterThanOrEqual(box.x - 1);
    expect(rect.x + rect.width).toBeLessThanOrEqual(box.x + box.width + 1);
  }
  const tops = new Set(await saved.locator(".pill").evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().top))));
  expect(tops.size).toBeGreaterThan(1);
  expect((await stored(page, 0)).find((entry) => entry.title === "Wochenende planen")!.tags).toEqual([
    "einkaufsliste", "wochenablauf", "gartenarbeit", "familienfeier", "steuerunterlagen", "reise",
  ]);
});

test("the details sheet takes several tags in one field and shows them back", async ({ page }) => {
  await seedTagged(page, "Mehrere Tags", ["Alpha", "Beta"]);
  await page.goto(app.baseUrl);
  await page.locator(".paper-row", { hasText: "Mehrere Tags" }).click();
  await page.locator(".inline-bar [data-action=details]").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator('input[name="tag"]')).toHaveValue("Alpha Beta");
  await dialog.locator('input[name="tag"]').fill("Beta Gamma beta");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".paper-row", { hasText: "Mehrere Tags" }).locator(".pill")).toHaveText(["Beta", "Gamma"]);
});
