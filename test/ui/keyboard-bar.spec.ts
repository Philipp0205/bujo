import { expect, test, type Page } from "@playwright/test";
import { pinClock, pinnedDay, useBujo } from "./harness.ts";

const app = useBujo();

test.beforeEach(async ({ page }) => {
  await pinClock(page);
  await app.signIn(page);
});

/** A calendar day as YYYY-MM-DD in the local time zone, n days from today (the page uses the local day too). */
const day = pinnedDay;

type Entry = { id: string; title: string; tags: string[]; time: string | null; indent: number };

/** Entries of one day as the API holds them, in order. Each test uses its own day, so tests do not see each other. */
async function stored(page: Page, offset: number): Promise<Entry[]> {
  const response = await page.request.get(`${app.baseUrl}/api/entries?from=${day(offset)}&to=${day(offset)}`);
  return (await response.json()).entries as Entry[];
}

/** Notes through the API, so nothing is pushed anywhere. */
async function seed(page: Page, offset: number, titles: string[]): Promise<void> {
  for (const title of titles) {
    const response = await page.request.post(`${app.baseUrl}/api/entries`, { data: { date: day(offset), type: "note", title } });
    expect(response.status()).toBe(201);
  }
}

const group = (page: Page, offset: number) => page.locator(`.paper-day-group[data-date="${day(offset)}"]`);
const row = (page: Page, offset: number, title: string) => group(page, offset).locator(".paper-row", { hasText: title });
const key = (page: Page, name: string) => page.locator(`.inline-bar .bar-key[data-key=${name}]`);

/** Opens a saved row for typing: tap it, the bar comes up. */
async function openRow(page: Page, offset: number, title: string): Promise<void> {
  await page.goto(`${app.baseUrl}/?day=${day(offset)}`);
  await row(page, offset, title).click();
  await expect(page.locator(".inline-bar")).toBeVisible();
}

test("the bar is one row of icon keys with a name each, after two handwritten word keys", async ({ page }) => {
  await seed(page, 1, ["Eins"]);
  await openRow(page, 1, "Eins");
  const keys = page.locator(".inline-bar .bar-key");
  await expect(keys).toHaveCount(12);
  await expect(key(page, "done")).toHaveText("Done");
  await expect(key(page, "next")).toHaveText("Next line");
  const icons = page.locator(".inline-bar .bar-key:not(.bar-word)");
  const texts = await icons.evaluateAll((nodes) => nodes.map((node) => (node.textContent ?? "").trim()));
  expect(texts.every((text) => text === "")).toBe(true);
  const names = await icons.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label")));
  expect(names).toEqual(["Tag", "Date", "Time", "Copy entry", "Delete entry", "Move up", "Move down", "Indent", "Indent back", "Details"]);
  await expect(icons.locator("svg").first()).toBeVisible();
});

test("delete removes a saved entry from the log and closes the bar", async ({ page }) => {
  await seed(page, 2, ["Bleibt", "Geht weg"]);
  await openRow(page, 2, "Geht weg");
  await key(page, "remove").click();

  await expect(row(page, 2, "Geht weg")).toHaveCount(0);
  await expect(row(page, 2, "Bleibt")).toHaveCount(1);
  await expect(page.locator(".inline-bar")).toBeHidden();
  expect((await stored(page, 2)).map((entry) => entry.title)).toEqual(["Bleibt"]);
});

test("delete on a new line only drops it", async ({ page }) => {
  await page.goto(app.baseUrl);
  await page.locator("[data-action=add-entry]").click();
  await page.keyboard.type("Nie gespeichert");
  await key(page, "remove").click();
  await expect(page.locator(".edit-sheet")).toBeHidden();
  await expect(page.locator(".inline-bar")).toBeHidden();
  await expect(page.locator(".paper-row", { hasText: "Nie gespeichert" })).toHaveCount(0);
});

test("move up and down reorder the day, keep the line open, and are off at the ends", async ({ page }) => {
  await seed(page, 3, ["a-eins", "b-zwei", "c-drei"]);
  await openRow(page, 3, "b-zwei");
  await expect(key(page, "up")).toHaveAttribute("aria-disabled", "false");

  await key(page, "up").click();
  await expect.poll(async () => (await stored(page, 3)).map((entry) => entry.title)).toEqual(["b-zwei", "a-eins", "c-drei"]);
  await expect(page.locator(".paper-line .paper-edit-input")).toHaveValue("b-zwei");
  await expect(key(page, "up")).toHaveAttribute("aria-disabled", "true");
  const order = await group(page, 3).locator(".paper-row").evaluateAll((rows) => rows.map((node) => node.getAttribute("data-id")));
  expect(order).toEqual((await stored(page, 3)).map((entry) => entry.id));

  await key(page, "up").click({ force: true });
  expect((await stored(page, 3)).map((entry) => entry.title)).toEqual(["b-zwei", "a-eins", "c-drei"]);

  await key(page, "down").click();
  await expect.poll(async () => (await stored(page, 3)).map((entry) => entry.title)).toEqual(["a-eins", "b-zwei", "c-drei"]);
  await key(page, "down").click();
  await expect.poll(async () => (await stored(page, 3)).map((entry) => entry.title)).toEqual(["a-eins", "c-drei", "b-zwei"]);
  await expect(key(page, "down")).toHaveAttribute("aria-disabled", "true");
});

test("indent nests an entry under the one above and outdent brings it back", async ({ page }) => {
  await seed(page, 4, ["Oben", "Unten"]);
  await openRow(page, 4, "Oben");
  await expect(key(page, "indent")).toHaveAttribute("aria-disabled", "true");
  await expect(key(page, "outdent")).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape");

  await row(page, 4, "Unten").click();
  await expect(key(page, "indent")).toHaveAttribute("aria-disabled", "false");
  await key(page, "indent").click();
  await expect(page.locator(".paper-edit")).toHaveAttribute("data-indent", "1");
  await expect.poll(async () => (await stored(page, 4)).map((entry) => entry.indent)).toEqual([0, 1]);
  await expect(key(page, "outdent")).toHaveAttribute("aria-disabled", "false");
  // The child moves into the parent's card at once, behind the open sheet.
  await expect(group(page, 4).locator(".entry-card")).toHaveCount(1);
  await expect(group(page, 4).locator(".entry-card .card-child .paper-row", { hasText: "Unten" })).toHaveCount(1);

  await page.keyboard.press("Escape");
  await expect(row(page, 4, "Unten")).toHaveAttribute("data-indent", "1");
  await expect(row(page, 4, "Oben")).toHaveAttribute("data-indent", "0");

  await row(page, 4, "Unten").click();
  await key(page, "outdent").click();
  await expect(page.locator(".paper-edit")).toHaveAttribute("data-indent", "0");
  await expect.poll(async () => (await stored(page, 4)).map((entry) => entry.indent)).toEqual([0, 0]);
});

test("a #tag and a time typed into a line become pills and leave the title", async ({ page }) => {
  await page.goto(app.baseUrl);
  await page.locator("[data-action=add-entry]").click();
  await page.keyboard.type("Zahnarzt #health ");
  await expect(page.locator(".paper-line .paper-edit-input")).toHaveValue("Zahnarzt ");
  await expect(page.locator(".sheet-chips .pill")).toHaveText(["health"]);
  await page.keyboard.type("14h30");
  await expect(page.locator(".paper-line .paper-edit-input")).toHaveValue("Zahnarzt 14h30");
  await page.keyboard.type(" ");
  await expect(page.locator(".paper-line .paper-edit-input")).toHaveValue("Zahnarzt ");
  await expect(page.locator(".sheet-chips .pill")).toHaveText(["health", "14:30"]);

  await page.keyboard.press("Enter");
  const saved = group(page, 0).locator(".paper-row[data-id]", { hasText: "Zahnarzt" });
  await expect(saved).toHaveCount(1);
  await expect(saved.locator(".paper-title")).toHaveText("Zahnarzt");
  await expect(saved.locator(".pill")).toHaveText(["health", "14:30"]);
  const entry = (await stored(page, 0)).find((item) => item.title === "Zahnarzt")!;
  expect(entry).toMatchObject({ tags: ["health"], time: "14:30" });
});

test("a tag at the very end is read when the line is saved", async ({ page }) => {
  await page.goto(app.baseUrl);
  await page.locator("[data-action=add-entry]").click();
  await page.keyboard.type("Mira anrufen #work");
  await expect(page.locator(".paper-line .paper-edit-input")).toHaveValue("Mira anrufen #work");
  await page.keyboard.press("Enter");
  const saved = group(page, 0).locator(".paper-row[data-id]", { hasText: "Mira anrufen" });
  await expect(saved.locator(".paper-title")).toHaveText("Mira anrufen");
  await expect(saved.locator(".pill")).toHaveText(["work"]);
});

test("a line that is only a #tag keeps its text", async ({ page }) => {
  await page.goto(app.baseUrl);
  await page.locator("[data-action=add-entry]").click();
  await page.keyboard.type("#nurtag");
  await page.keyboard.press("Enter");
  await expect(group(page, 0).locator(".paper-row[data-id] .paper-title", { hasText: "#nurtag" })).toHaveCount(1);
});
