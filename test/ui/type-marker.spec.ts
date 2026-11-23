import { expect, test, type Page } from "@playwright/test";
import { useBujo } from "./harness.ts";

const app = useBujo();

test.beforeEach(async ({ page }) => {
  await app.signIn(page);
  // The install banner and the what's new sheet would sit over the log, so both are out of the way before any page script runs.
  await page.addInitScript(() => sessionStorage.setItem("ak-install-prompt-dismissed", "1"));
  await page.request.put(`${app.baseUrl}/api/whats-new/seen`, { data: { id: "2026-11-23-important" } });
});

/** A calendar day as YYYY-MM-DD in the local time zone, n days from today (the page uses the local day too). */
function day(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

type Entry = { id: string; date: string; type: string; title: string };

/** The entries the API holds for a window of days around today, whose title has the word. */
async function serverEntries(page: Page, word: string): Promise<Entry[]> {
  const response = await page.request.get(`${app.baseUrl}/api/entries?from=${day(-10)}&to=${day(10)}`);
  return ((await response.json()).entries as Entry[]).filter((entry) => entry.title.includes(word));
}

const marker = (page: Page) => page.getByTestId("type-marker");
const chooser = (page: Page) => page.getByTestId("type-chooser");
const title = (page: Page) => page.getByRole("textbox", { name: "Entry title" });
const row = (page: Page, text: string) => page.locator(".paper-row", { hasText: text });
const option = (page: Page, type: string) => chooser(page).locator(`.type-option[data-type="${type}"]`);

/** Opens the log and starts a new line with the Add entry row. */
async function newLine(page: Page): Promise<void> {
  await page.goto(app.baseUrl);
  await page.locator("[data-action=add-entry]").click();
  await expect(title(page)).toBeFocused();
}

test("the marker is a named, tappable control and the bar has no Type key", async ({ page }) => {
  await newLine(page);
  await expect(marker(page)).toBeVisible();
  await expect(marker(page)).toHaveAttribute("aria-haspopup", "true");
  await expect(marker(page)).toHaveAttribute("aria-expanded", "false");
  await expect(marker(page)).toHaveAccessibleName("Entry type: Task");

  const box = (await marker(page).boundingBox())!;
  const hit = await marker(page).evaluate((el) => {
    const after = getComputedStyle(el, "::after");
    return { top: parseFloat(after.top), bottom: parseFloat(after.bottom), left: parseFloat(after.left), height: el.getBoundingClientRect().height, width: el.getBoundingClientRect().width };
  });
  // The ::after reaches past the chip by its negative insets: the target is at least 44px tall and wide, and ends at the chip's right edge.
  expect(box.height - hit.top - hit.bottom).toBeGreaterThanOrEqual(44);
  expect(box.width - hit.left).toBeGreaterThanOrEqual(44);
  const input = (await title(page).boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(input.x);

  await expect(page.locator(".inline-bar .bar-key[data-key=type]")).toHaveCount(0);
  await expect(page.locator('.inline-bar [aria-label="Entry type"]')).toHaveCount(0);
});

test("a tap opens the chooser with every type, symbol and label, the current one selected", async ({ page }) => {
  await newLine(page);
  await marker(page).click();
  await expect(chooser(page)).toBeVisible();
  await expect(marker(page)).toHaveAttribute("aria-expanded", "true");
  await expect(title(page)).toBeFocused();

  const options = chooser(page).locator(".type-option");
  await expect(options).toHaveCount(6);
  expect(await options.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-type")))).toEqual(
    ["task", "done", "migrated", "scheduled", "event", "note"],
  );
  await expect(options.locator(".type-option-label")).toHaveText(["Task", "Done", "Moved", "Scheduled", "Event", "Note"]);
  await expect(options.locator("svg")).toHaveCount(6);
  await expect(option(page, "task")).toHaveAttribute("aria-pressed", "true");
  await expect(chooser(page).locator('.type-option[aria-pressed="true"]')).toHaveCount(1);

  // The chooser sits fully above the accessory bar and on the screen.
  const above = (await chooser(page).boundingBox())!;
  const bar = (await page.locator(".inline-bar").boundingBox())!;
  expect(above.y).toBeGreaterThanOrEqual(0);
  expect(above.y + above.height).toBeLessThanOrEqual(bar.y);
  expect(above.x + above.width).toBeLessThanOrEqual(390);
});

test("one tap picks a type, closes the chooser, keeps the title focused, and the save keeps the type", async ({ page }) => {
  await newLine(page);
  await page.keyboard.type("Marker Event");
  await marker(page).click();
  await option(page, "event").click();

  await expect(chooser(page)).toHaveCount(0);
  await expect(marker(page)).toHaveAttribute("aria-expanded", "false");
  await expect(marker(page).locator("use")).toHaveAttribute("href", "#g-event");
  await expect(marker(page)).toHaveAccessibleName("Entry type: Event");
  await expect(title(page)).toBeFocused();
  await expect(page.getByTestId("edit-sheet")).toBeVisible();
  await expect(title(page)).toHaveValue("Marker Event");

  await page.keyboard.press("Enter");
  await expect(row(page, "Marker Event")).toHaveAttribute("data-type", "event");
  expect((await serverEntries(page, "Marker Event"))[0]).toMatchObject({ type: "event", date: day(0) });
});

test("Escape closes the chooser first and leaves the sheet open, a second Escape saves", async ({ page }) => {
  await newLine(page);
  await page.keyboard.type("Marker Escape");
  await marker(page).click();
  await expect(chooser(page)).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(chooser(page)).toHaveCount(0);
  await expect(page.getByTestId("edit-sheet")).toBeVisible();
  await expect(title(page)).toBeFocused();
  expect(await serverEntries(page, "Marker Escape")).toHaveLength(0);

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("edit-sheet")).toBeHidden();
  await expect(row(page, "Marker Escape")).toBeVisible();
});

test("a second tap on the marker closes the chooser", async ({ page }) => {
  await newLine(page);
  await marker(page).click();
  await expect(chooser(page)).toBeVisible();
  await marker(page).click();
  await expect(chooser(page)).toHaveCount(0);
  await expect(title(page)).toBeFocused();
});

test("Back closes the chooser first, then the sheet", async ({ page }) => {
  await newLine(page);
  await marker(page).click();
  await expect(chooser(page)).toBeVisible();

  await page.goBack();
  await expect(chooser(page)).toHaveCount(0);
  await expect(page.getByTestId("edit-sheet")).toBeVisible();

  await page.goBack();
  await expect(page.getByTestId("edit-sheet")).toBeHidden();
});

test("an existing entry set to scheduled asks where it goes, and This day keeps its date with no trace", async ({ page }) => {
  const created = await page.request.post(`${app.baseUrl}/api/entries`, { data: { date: day(2), type: "task", title: "Marker Termin" } });
  expect(created.status()).toBe(201);
  await page.goto(`${app.baseUrl}/?day=${day(2)}`);
  await row(page, "Marker Termin").click();
  await expect(marker(page)).toHaveAccessibleName("Entry type: Task");

  await marker(page).click();
  await option(page, "scheduled").click();
  const move = page.getByTestId("move-chooser");
  await expect(move).toBeVisible();
  await expect(move).toHaveAttribute("data-kind", "schedule");
  await expect(title(page)).toBeFocused();
  await move.locator('[data-dest="here"]').click();
  await expect(move).toHaveCount(0);

  await expect(marker(page).locator("use")).toHaveAttribute("href", "#g-sched");
  await page.locator(".inline-bar [data-key=date]").click();
  await expect(page.locator('.inline-pop input[name="date"]')).toHaveValue(day(2));
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  await expect(page.getByTestId("edit-sheet")).toBeHidden();
  await expect(row(page, "Marker Termin")).toHaveAttribute("data-type", "scheduled");
  await expect(page.getByTestId("trace-row")).toHaveCount(0);
  expect((await serverEntries(page, "Marker Termin"))[0]).toMatchObject({ type: "scheduled", date: day(2) });
});

test("offline, a type picked from the marker is queued with the entry and shown as waiting to send", async ({ page }) => {
  await page.goto(app.baseUrl);
  await page.waitForFunction(() => !!document.querySelector(".paper-add"));
  await page.context().setOffline(true);

  await page.locator("[data-action=add-entry]").click();
  await title(page).fill("Marker Offline");
  await marker(page).click();
  await option(page, "note").click();
  await page.keyboard.press("Enter");

  const queued = row(page, "Marker Offline");
  await expect(queued).toHaveAttribute("data-queued", "create");
  await expect(queued).toHaveAttribute("data-type", "note");
  await expect(queued.getByTestId("waiting-to-send")).toBeVisible();

  await page.context().setOffline(false);
  await expect(page.getByTestId("waiting-to-send")).toHaveCount(0);
  expect((await serverEntries(page, "Marker Offline"))[0]).toMatchObject({ type: "note" });
});
