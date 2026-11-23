import { expect, test, type Page } from "@playwright/test";
import { useBujo } from "./harness.ts";

const app = useBujo();

/** The ids that existed before the test started. The account is shared by the whole file and has no delete route. */
let before = new Set<string>();

test.beforeEach(async ({ page }) => {
  await app.signIn(page);
  before = new Set((await everything(page)).map((entry) => entry.id));
});

/** A calendar day as YYYY-MM-DD in the local time zone, n days from today (the page uses the local day too). */
function day(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

type Entry = { id: string; date: string; type: string; title: string; tags: string[]; time: string | null };

/** Every entry the API holds for the days around today, read with the page's session. */
async function everything(page: Page): Promise<Entry[]> {
  const response = await page.request.get(`${app.baseUrl}/api/entries?from=${day(-6)}&to=${day(7)}`);
  return (await response.json()).entries as Entry[];
}

/** The entries this test created or changed the title of, so earlier tests of the file do not count. */
async function stored(page: Page): Promise<Entry[]> {
  return (await everything(page)).filter((entry) => !before.has(entry.id));
}

/** All titles the API holds right now. */
async function titles(page: Page): Promise<string[]> {
  return (await everything(page)).map((entry) => entry.title);
}

/** A fresh entry through the API, remembered as existing before the test body so it is not counted as created. */
async function seedEntry(page: Page, data: Record<string, unknown>): Promise<void> {
  const response = await page.request.post(`${app.baseUrl}/api/entries`, { data });
  expect(response.status()).toBe(201);
  before.add(((await response.json()).entry as Entry).id);
}

const today = (page: Page) => page.locator(`.paper-day-group[data-date="${day(0)}"]`);
const saved = (page: Page, title: string) => today(page).locator(".paper-row[data-id]", { hasText: title });
const line = (page: Page) => page.locator(".paper-line .paper-edit-input");
const sheet = (page: Page) => page.locator(".edit-sheet");

test("tap add, type a title, Enter creates a task on today", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(app.baseUrl);
  await page.locator("[data-action=add-entry]").click();
  await expect(line(page)).toBeFocused();
  await page.keyboard.type("  Zahnarzt anrufen  ");
  await page.keyboard.press("Enter");

  await expect(saved(page, "Zahnarzt anrufen")).toHaveAttribute("data-type", "task");
  await expect(saved(page, "Zahnarzt anrufen").locator(".paper-title")).toHaveText("Zahnarzt anrufen");
  await expect(sheet(page)).toBeHidden();
  const entries = await stored(page);
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ date: day(0), type: "task", title: "Zahnarzt anrufen" });
  expect(errors).toEqual([]);
});

test("the empty space under today's last entry starts a line too", async ({ page }) => {
  await seedEntry(page, { date: day(0), type: "task", title: "Schon da" });
  await page.goto(app.baseUrl);
  await expect(saved(page, "Schon da")).toBeVisible();
  const area = (await today(page).boundingBox())!;
  await page.touchscreen.tap(area.x + area.width - 12, area.y + area.height - 10);
  await expect(line(page)).toBeFocused();
  await expect(sheet(page)).toBeVisible();
  await expect(page.locator(".paper-line[data-new=true]")).toHaveCount(1);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("Enter saves the line and closes the sheet completely", async ({ page }) => {
  await page.goto(app.baseUrl);
  await page.locator("[data-action=add-entry]").click();
  await page.keyboard.type("Erste Zeile");
  await page.keyboard.press("Enter");

  await expect(saved(page, "Erste Zeile")).toBeVisible();
  await expect(sheet(page)).toBeHidden();
  await expect(page.locator(".inline-bar")).toBeHidden();
  await expect(page.locator(".paper-row:not([data-id])")).toHaveCount(0);
  await expect(page.locator('[data-state="loading"]')).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("TEXTAREA");
  expect((await stored(page)).map((entry) => entry.title)).toEqual(["Erste Zeile"]);
});

test("the + Next key saves the line and opens a fresh focused one, with no loading note between", async ({ page }) => {
  await page.goto(app.baseUrl);
  await page.locator("[data-action=add-entry]").click();
  await page.keyboard.type("Naechste eins");
  await page.locator(".bar-key[data-key=next]").click();

  await expect(saved(page, "Naechste eins")).toBeVisible();
  await expect(sheet(page)).toBeVisible();
  await expect(line(page)).toHaveValue("");
  await expect(line(page)).toBeFocused();
  await expect(page.locator(".paper-line[data-new=true]")).toHaveCount(1);
  await expect(page.locator('[data-state="loading"]')).toHaveCount(0);

  await page.keyboard.type("Naechste zwei");
  await page.locator(".bar-key[data-key=next]").click();
  await expect(saved(page, "Naechste zwei")).toBeVisible();
  await expect(saved(page, "Naechste eins")).toBeVisible();
  await expect(line(page)).toBeFocused();
  expect((await stored(page)).map((entry) => entry.title).sort()).toEqual(["Naechste eins", "Naechste zwei"]);
});

test("Enter on an empty new line closes the sheet and saves nothing", async ({ page }) => {
  await page.goto(app.baseUrl);
  await page.locator("[data-action=add-entry]").click();
  await page.keyboard.press("Enter");
  await expect(sheet(page)).toBeHidden();
  await expect(page.locator(".paper-row:not([data-id])")).toHaveCount(0);
  expect(await stored(page)).toHaveLength(0);
});

test("the + Next key on an empty new line saves nothing and keeps the sheet open and focused", async ({ page }) => {
  await page.goto(app.baseUrl);
  await page.locator("[data-action=add-entry]").click();
  await page.locator(".bar-key[data-key=next]").click();
  await expect(sheet(page)).toBeVisible();
  await expect(line(page)).toBeFocused();
  expect(await stored(page)).toHaveLength(0);
});

test("Backspace on an empty new line removes it and hides the bar, with no entry created", async ({ page }) => {
  await page.goto(app.baseUrl);
  await page.locator("[data-action=add-entry]").click();
  await expect(page.locator(".inline-bar")).toBeVisible();
  await page.keyboard.press("Backspace");

  await expect(sheet(page)).toBeHidden();
  await expect(page.locator(".paper-row:not([data-id])")).toHaveCount(0);
  await expect(page.locator(".inline-bar")).toBeHidden();
  expect(await stored(page)).toHaveLength(0);
});

test("Backspace with text only deletes a character", async ({ page }) => {
  await page.goto(app.baseUrl);
  await page.locator("[data-action=add-entry]").click();
  await page.keyboard.type("ab");
  await page.keyboard.press("Backspace");
  await expect(line(page)).toHaveValue("a");
  await expect(sheet(page)).toBeVisible();
});

test("blur saves a non-empty new line and drops an empty one", async ({ page }) => {
  await page.goto(app.baseUrl);
  await page.locator("[data-action=add-entry]").click();
  await page.keyboard.type("Beim Verlassen gespeichert");
  await page.locator("h1").click();
  await expect(saved(page, "Beim Verlassen")).toBeVisible();
  await expect(sheet(page)).toBeHidden();
  await expect(page.locator(".inline-bar")).toBeHidden();

  await page.locator("[data-action=add-entry]").click();
  await expect(line(page)).toBeFocused();
  await page.locator("h1").click();
  await expect(sheet(page)).toBeHidden();
  await expect(page.locator(".inline-bar")).toBeHidden();
  expect(await stored(page)).toHaveLength(1);
});

test("Escape on an empty new line drops it, on a non-empty one it saves it", async ({ page }) => {
  await page.goto(app.baseUrl);
  await page.locator("[data-action=add-entry]").click();
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toBeHidden();
  expect(await stored(page)).toHaveLength(0);

  await page.locator("[data-action=add-entry]").click();
  await page.keyboard.type("Mit Escape gespeichert");
  await page.keyboard.press("Escape");
  await expect(saved(page, "Mit Escape")).toBeVisible();
  await expect(sheet(page)).toBeHidden();
  expect(await stored(page)).toHaveLength(1);
});

test("type set through the marker, tag, day and time through the bar are saved with the line", async ({ page }) => {
  await page.goto(app.baseUrl);
  await page.locator("[data-action=add-entry]").click();
  await page.keyboard.type("Zahnarzt");

  await page.getByTestId("type-marker").click();
  await expect(page.locator(".type-chooser .type-option")).toHaveCount(6);
  await expect(line(page)).toHaveValue("Zahnarzt");
  await page.locator('.type-chooser .type-option[data-type="event"]').click();
  await expect(page.getByTestId("type-chooser")).toHaveCount(0);
  await expect(page.locator(".paper-line .type-marker use")).toHaveAttribute("href", "#g-event");

  await page.locator(".bar-key[data-key=tag]").click();
  await page.locator('.inline-pop input[name="tag"]').fill("Gesundheit");
  await page.keyboard.press("Enter");
  await expect(page.locator(".inline-pop .pop-tag[aria-selected=true]")).toHaveText(["\u2713#Gesundheit"]);
  await page.keyboard.press("Escape");
  await expect(page.locator(".inline-pop")).toHaveCount(0);

  await page.locator(".bar-key[data-key=time]").click();
  await page.locator('.inline-pop input[name="time"]').fill("09:30");
  await expect(page.locator(".inline-pop")).toHaveCount(0);
  await expect(page.locator(".sheet-chips .pill")).toHaveText(["Gesundheit", "09:30"]);
  await expect(line(page)).toHaveValue("Zahnarzt");

  await line(page).press("Enter");
  const created = today(page).locator('.paper-row[data-type="event"]', { hasText: "Zahnarzt" });
  await expect(created).toHaveCount(1);
  await expect(created.locator(".pill")).toHaveText(["Gesundheit", "09:30"]);
  await expect(sheet(page)).toBeHidden();
  expect((await stored(page))[0]).toMatchObject({ type: "event", tags: ["Gesundheit"], time: "09:30", date: day(0) });
});

test("a new line given another day leaves this page and lands on that day's page after saving", async ({ page }) => {
  await page.goto(app.baseUrl);
  await page.locator("[data-action=add-entry]").click();
  await page.keyboard.type("Morgen erledigen");
  await page.locator(".bar-key[data-key=date]").click();
  await page.locator('.inline-pop input[name="date"]').fill(day(1));
  await page.keyboard.press("Enter");

  // Today's page does not show it, the sheet is closed, and the entry is stored on the other day.
  await expect(saved(page, "Morgen erledigen")).toHaveCount(0);
  await expect.poll(async () => (await stored(page)).map((entry) => `${entry.date} ${entry.title}`)).toEqual([`${day(1)} Morgen erledigen`]);
  await expect(sheet(page)).toBeHidden();
  // Tomorrow now has an entry, so it is a page: the next arrow turns to it.
  await expect(page.getByTestId("page-next")).toBeEnabled();
  await page.getByTestId("page-next").click();
  await expect(page.getByTestId("page-body")).toHaveAttribute("data-date", day(1));
  await expect(page.locator(`.paper-day-group[data-date="${day(1)}"] .paper-row`, { hasText: "Morgen erledigen" })).toBeVisible();
});

test("the type chooser closes on Escape first, then a tap outside closes it and saves the draft", async ({ page }) => {
  await page.goto(app.baseUrl);
  await page.locator("[data-action=add-entry]").click();
  await page.keyboard.type("Entwurf");

  await page.getByTestId("type-marker").click();
  await expect(page.getByTestId("type-chooser")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("type-chooser")).toHaveCount(0);
  await expect(line(page)).toHaveValue("Entwurf");
  await expect(line(page)).toBeFocused();
  expect(await stored(page)).toHaveLength(0);

  await page.getByTestId("type-marker").click();
  await expect(page.getByTestId("type-chooser")).toBeVisible();
  await page.locator(".paper-head h1").click();
  // The tap closes the chooser, and its blur saves the line like any other blur: the draft is not lost.
  await expect(page.getByTestId("type-chooser")).toHaveCount(0);
  await expect(saved(page, "Entwurf")).toBeVisible();
  await expect(sheet(page)).toBeHidden();
  expect(await stored(page)).toHaveLength(1);
});

test("tapping an existing row lets you change the title inline and save it", async ({ page }) => {
  await seedEntry(page, { date: day(0), type: "task", title: "Alter Titel", tags: ["Haushalt"] });
  await page.goto(app.baseUrl);
  await saved(page, "Alter Titel").click();

  await expect(line(page)).toHaveValue("Alter Titel");
  await expect(line(page)).toBeFocused();
  await expect(page.locator(".paper-line[data-new=false]")).toHaveCount(1);
  await expect(page.locator(".inline-bar [data-action=details]")).toBeVisible();
  await line(page).fill("Neuer Titel");
  await page.keyboard.press("Enter");

  await expect(saved(page, "Neuer Titel")).toBeVisible();
  await expect(saved(page, "Neuer Titel").locator(".pill")).toHaveText(["Haushalt"]);
  await expect(sheet(page)).toBeHidden();
  await expect(page.locator(".paper-line[data-new=true]")).toHaveCount(0);
  const all = await everything(page);
  expect(all.filter((entry) => entry.title === "Alter Titel")).toHaveLength(0);
  expect(all.filter((entry) => entry.title === "Neuer Titel")).toHaveLength(1);
  expect(all.find((entry) => entry.title === "Neuer Titel")).toMatchObject({ tags: ["Haushalt"] });
});

test("an existing entry with its title cleared goes back to the old title and is not deleted", async ({ page }) => {
  await seedEntry(page, { date: day(0), type: "task", title: "Bleibt bestehen" });
  await page.goto(app.baseUrl);
  await saved(page, "Bleibt bestehen").click();
  await line(page).fill("");
  await page.keyboard.press("Escape");

  await expect(sheet(page)).toBeHidden();
  await expect(saved(page, "Bleibt bestehen")).toBeVisible();
  expect(await titles(page)).toContain("Bleibt bestehen");

  await saved(page, "Bleibt bestehen").click();
  await line(page).fill("   ");
  await page.locator("h1").click();
  await expect(saved(page, "Bleibt bestehen")).toBeVisible();
  expect(await titles(page)).toContain("Bleibt bestehen");
  expect(await stored(page)).toHaveLength(0);
});

test("blur saves a changed title of an existing entry", async ({ page }) => {
  await seedEntry(page, { date: day(0), type: "task", title: "Vorher" });
  await page.goto(app.baseUrl);
  await saved(page, "Vorher").click();
  await line(page).fill("Nachher");
  await page.locator("h1").click();
  await expect(saved(page, "Nachher")).toBeVisible();
  const all = await titles(page);
  expect(all).toContain("Nachher");
  expect(all).not.toContain("Vorher");
});

test("a note with a body still opens the note sheet, not the inline editor", async ({ page }) => {
  await seedEntry(page, { date: day(0), type: "note", title: "Lange Notiz", body: "# Titel\n- Punkt" });
  await page.goto(app.baseUrl);
  await saved(page, "Lange Notiz").click();
  await expect(page.getByTestId("note-sheet")).toBeVisible();
  await expect(sheet(page)).toBeHidden();
  await expect(page.locator(".inline-bar")).toBeHidden();
});

test("a short note edits inline and keeps no sync label or dot while typing", async ({ page }) => {
  await seedEntry(page, { date: day(0), type: "note", title: "Kurzer Gedanke" });
  await page.goto(app.baseUrl);
  await saved(page, "Kurzer Gedanke").click();
  await expect(page.locator(".paper-line .sync-mark")).toHaveCount(0);
  await expect(page.locator(".paper-line")).not.toContainText(/not synced/i);
  await line(page).fill("Kurzer Gedanke, neu");
  await page.keyboard.press("Escape");
  await expect(saved(page, "Kurzer Gedanke, neu")).toHaveAttribute("data-type", "note");
  await expect(saved(page, "Kurzer Gedanke, neu").locator(".sync-mark")).toHaveCount(0);
});

test("Details saves the line and opens the sheet of the saved entry", async ({ page }) => {
  await seedEntry(page, { date: day(0), type: "task", title: "Mehr Felder" });
  await page.goto(app.baseUrl);
  await saved(page, "Mehr Felder").click();
  await line(page).fill("Mehr Felder, geändert");
  await page.locator(".inline-bar [data-action=details]").click();

  const sheet = page.getByRole("dialog");
  await expect(sheet.locator('input[name="title"]')).toHaveValue("Mehr Felder, geändert");
  await expect(page.locator(".inline-bar")).toBeHidden();
});

test("the bar has no Details control for a new line", async ({ page }) => {
  await page.goto(app.baseUrl);
  await page.locator("[data-action=add-entry]").click();
  await expect(page.locator(".inline-bar [data-action=details]")).toBeHidden();
});

test("the edit sheet is pinned to the bottom of the visual viewport when a keyboard shrinks it", async ({ page }) => {
  await page.goto(app.baseUrl);
  await page.locator("[data-action=add-entry]").click();
  // Pretend a 300px keyboard: the sheet (and the bar at its foot) is pinned to the bottom of the shrunken visual viewport.
  await page.evaluate(() => {
    const fake = Object.assign(new EventTarget(), { height: 544, offsetTop: 0, width: 390 });
    Object.defineProperty(window, "visualViewport", { value: fake, configurable: true });
    (window as unknown as { __fakeVv: EventTarget }).__fakeVv = fake;
  });
  await page.evaluate(() => (window as unknown as { BujoLog: { inline: { viewport: { place(el: Element): void } } } }).BujoLog.inline.viewport.place(document.querySelector(".edit-sheet")!));
  const box = (await sheet(page).boundingBox())!;
  expect(Math.round(box.y + box.height)).toBe(544);
  const bar = (await page.locator(".inline-bar").boundingBox())!;
  expect(Math.round(bar.y + bar.height)).toBeLessThanOrEqual(544);
  expect(bar.y).toBeGreaterThan(box.y);
});

const LONG_TITLE = "Den langen Bericht fuer das Quartal noch einmal in Ruhe durchlesen, die Zahlen mit dem Vorjahr vergleichen und danach alles zusammenfassen";

test("a long title wraps, the field grows, and Enter saves it as one line", async ({ page }) => {
  await page.goto(app.baseUrl);
  await page.locator("[data-action=add-entry]").click();
  const input = line(page);
  const oneLine = (await input.boundingBox())!.height;
  expect(oneLine).toBe(32);

  await input.fill(LONG_TITLE);
  await expect.poll(async () => (await input.boundingBox())!.height).toBeGreaterThanOrEqual(96);
  const metrics = await input.evaluate((node) => ({ scroll: node.scrollWidth, client: node.clientWidth, value: (node as HTMLTextAreaElement).value }));
  expect(metrics.scroll).toBeLessThanOrEqual(metrics.client);
  expect(metrics.value).toBe(LONG_TITLE);
  expect(metrics.value).not.toMatch(/[\n\r]/);

  await page.keyboard.press("Enter");
  await expect(saved(page, "Quartal")).toBeVisible();
  await expect(sheet(page)).toBeHidden();
  const entries = await stored(page);
  expect(entries.map((entry) => entry.title)).toEqual([LONG_TITLE]);
});

test("pasted line breaks become spaces, so the title stays one line", async ({ page }) => {
  await page.goto(app.baseUrl);
  await page.locator("[data-action=add-entry]").click();
  await line(page).evaluate((node) => {
    const area = node as HTMLTextAreaElement;
    area.value = "Erste\nZweite\nDritte";
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(line(page)).toHaveValue("Erste Zweite Dritte");
  await page.keyboard.press("Enter");
  await expect(saved(page, "Erste Zweite")).toBeVisible();
  await expect(sheet(page)).toBeHidden();
  expect((await stored(page)).map((entry) => entry.title)).toEqual(["Erste Zweite Dritte"]);
});

test("the field stops growing at its cap and scrolls inside", async ({ page }) => {
  await page.goto(app.baseUrl);
  await page.locator("[data-action=add-entry]").click();
  await line(page).fill(("Wort ").repeat(39).trim());
  const input = line(page);
  const cap = await input.evaluate((node) => parseFloat(getComputedStyle(node).maxHeight));
  await expect.poll(async () => (await input.boundingBox())!.height).toBeLessThanOrEqual(cap);
  expect(await input.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
  expect(await input.evaluate((node) => getComputedStyle(node).overflowY)).toBe("auto");
  const box = (await sheet(page).boundingBox())!;
  expect(box.y).toBeGreaterThan(0);
});

