import { expect, test, type Page } from "@playwright/test";
import { pinClock, pinnedDay, useBujo, WHATS_NEW_NEWEST } from "./harness.ts";
import { finger } from "./touch.ts";

const app = useBujo();
const today = () => pinnedDay(0);

/** How long a finger rests before it moves: past the drag hold (280 ms) and well short of the held-still time (500 ms), so a slow machine still drags. */
const HELD_WAIT = 340;

test.beforeEach(async ({ page }) => {
  await pinClock(page);
  await app.signIn(page);
  await page.addInitScript(() => sessionStorage.setItem("ak-install-prompt-dismissed", "1"));
  await page.request.put(`${app.baseUrl}/api/whats-new/seen`, { data: { id: WHATS_NEW_NEWEST } });
});

test.afterEach(async ({ page }) => {
  const { entries } = await (await page.request.get(`${app.baseUrl}/api/entries?from=${today()}&to=${today()}`)).json();
  for (const entry of entries) await page.request.delete(`${app.baseUrl}/api/entries/${entry.id}`);
});

/** Fake entries of today through the API, in order. Returns their ids. */
async function seed(page: Page, titles: string[], type = "task"): Promise<string[]> {
  const ids: string[] = [];
  for (const title of titles) {
    const response = await page.request.post(`${app.baseUrl}/api/entries`, { data: { date: today(), type, title } });
    expect(response.status()).toBe(201);
    ids.push((await response.json()).entry.id);
  }
  return ids;
}

const row = (page: Page, title: string) => page.locator(".paper-row", { hasText: title });
const shown = (page: Page) => page.locator(".paper-row:not(.paper-trace) .paper-title");

/** The titles of today as the server holds them, in order. */
async function stored(page: Page): Promise<string[]> {
  const { entries } = await (await page.request.get(`${app.baseUrl}/api/entries?from=${today()}&to=${today()}`)).json();
  return entries.map((entry: { title: string }) => entry.title);
}

async function openLog(page: Page): Promise<void> {
  await page.goto(app.baseUrl);
  await expect(page.getByRole("heading", { name: "Daily Log", level: 1 })).toBeVisible();
  await page.waitForFunction(() => !!document.querySelector(".paper-add"));
  await page.waitForLoadState("networkidle");
}

/** The middle of a row on screen, after it is scrolled clear of the tab bar. */
async function centerOf(page: Page, title: string, edge = 0.5): Promise<{ x: number; y: number }> {
  await row(page, title).evaluate((node) => node.scrollIntoView({ block: "center" }));
  const box = (await row(page, title).boundingBox())!;
  return { x: box.x + box.width * 0.6, y: box.y + box.height * edge };
}

/** Holds a finger on a row past the hold time and drags it onto another row (edge 0 is its top, 1 its bottom), leaving the finger down unless release is false. */
async function holdAndDrag(page: Page, from: string, to: string, edge = 0.5, release = true): Promise<void> {
  const start = await centerOf(page, from);
  const target = await centerOf(page, to, edge);
  const touch = await finger(page);
  await touch.down(start.x, start.y);
  await page.waitForTimeout(HELD_WAIT);
  await touch.move(target.x, target.y, 10);
  if (release) await touch.up();
}

test("a tap on a row still opens the editor", async ({ page }) => {
  await seed(page, ["Eins", "Zwei"]);
  await openLog(page);
  await row(page, "Zwei").tap();
  await expect(page.getByTestId("edit-sheet")).toBeVisible();
  await expect(shown(page)).toHaveText(["Eins", "Zwei"]);
});

test("holding a row and dragging it down puts it in its new place, and the order survives a reload", async ({ page }) => {
  await seed(page, ["Alpha", "Bravo", "Charlie", "Delta"]);
  await openLog(page);
  await holdAndDrag(page, "Alpha", "Charlie", 0.8);
  await expect(shown(page)).toHaveText(["Bravo", "Charlie", "Alpha", "Delta"]);
  await expect.poll(() => stored(page)).toEqual(["Bravo", "Charlie", "Alpha", "Delta"]);
  await expect(page.getByTestId("edit-sheet")).toBeHidden();

  await page.reload();
  await expect(shown(page)).toHaveText(["Bravo", "Charlie", "Alpha", "Delta"]);
  await page.waitForLoadState("networkidle");
  await expect(shown(page)).toHaveText(["Bravo", "Charlie", "Alpha", "Delta"]);
});

test("a row dragged up lands above the row it was dropped on", async ({ page }) => {
  await seed(page, ["Alpha", "Bravo", "Charlie", "Delta"]);
  await openLog(page);
  await holdAndDrag(page, "Delta", "Bravo", 0.2);
  await expect(shown(page)).toHaveText(["Alpha", "Delta", "Bravo", "Charlie"]);
  await expect.poll(() => stored(page)).toEqual(["Alpha", "Delta", "Bravo", "Charlie"]);
});

test("while dragging the row is lifted and a dashed slot shows where it lands; the others make room", async ({ page }) => {
  await seed(page, ["Alpha", "Bravo", "Charlie"]);
  await openLog(page);
  const before = (await row(page, "Bravo").boundingBox())!;
  const start = await centerOf(page, "Alpha");
  const target = await centerOf(page, "Charlie", 0.8);
  const touch = await finger(page);
  await touch.down(start.x, start.y);
  await page.waitForTimeout(HELD_WAIT);
  await touch.move(target.x, target.y, 10);
  await expect(page.locator(".is-lifted")).toHaveCount(1);
  await expect(page.getByTestId("drag-slot")).toBeVisible();
  const lifted = (await page.locator(".is-lifted .paper-row").boundingBox())!;
  const moved = (await row(page, "Bravo").boundingBox())!;
  expect(lifted.y).toBeGreaterThan(before.y);
  expect(moved.y).toBeLessThan(before.y);
  await touch.up();
  await expect(page.locator(".is-lifted")).toHaveCount(0);
  await expect(page.getByTestId("drag-slot")).toHaveCount(0);
});

test("a quick move on a row does not drag: it scrolls the page and the order stays", async ({ page }) => {
  await seed(page, Array.from({ length: 18 }, (_, index) => `Zeile ${String(index + 1).padStart(2, "0")}`));
  await openLog(page);
  const before = await stored(page);
  const start = await centerOf(page, "Zeile 04");
  const touch = await finger(page);
  await touch.down(start.x, start.y);
  await touch.move(start.x, start.y - 260, 8, 8);
  await touch.up();
  await expect.poll(() => page.locator("#log").evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await expect(page.locator(".is-lifted")).toHaveCount(0);
  expect(await stored(page)).toEqual(before);
});

test("a quick sideways swipe on an open task opens the move chooser and does not drag", async ({ page }) => {
  await seed(page, ["Alpha", "Bravo"]);
  await openLog(page);
  const start = await centerOf(page, "Alpha");
  const touch = await finger(page);
  await touch.down(start.x - 100, start.y);
  await touch.move(start.x + 100, start.y, 8, 8);
  await touch.up();
  await expect(page.getByTestId("move-chooser")).toBeVisible();
  await expect(page.locator(".is-lifted")).toHaveCount(0);
  expect(await stored(page)).toEqual(["Alpha", "Bravo"]);
});

test("holding a row still, without moving, opens the planet menu, and its select bubble starts select mode", async ({ page }) => {
  await seed(page, ["Alpha", "Bravo"]);
  await openLog(page);
  const start = await centerOf(page, "Alpha");
  const touch = await finger(page);
  await touch.down(start.x, start.y);
  await page.waitForTimeout(700);
  await touch.up();
  await expect(page.getByTestId("radial-menu")).toBeVisible();
  await expect(page.locator(".is-lifted")).toHaveCount(0);
  await expect(page.getByTestId("edit-sheet")).toBeHidden();
  await page.getByTestId("radial-select").click();
  await expect(page.getByTestId("select-bar")).toBeVisible();
});

test("a card with an entry nested under it moves as one", async ({ page }) => {
  const [, kidId] = await seed(page, ["Eltern", "Kind", "Zwei"]);
  expect((await page.request.patch(`${app.baseUrl}/api/entries/${kidId}`, { data: { indent: 1 } })).status()).toBe(200);
  await openLog(page);
  await holdAndDrag(page, "Eltern", "Zwei", 0.8);
  await expect(shown(page)).toHaveText(["Zwei", "Eltern", "Kind"]);
  await expect.poll(() => stored(page)).toEqual(["Zwei", "Eltern", "Kind"]);
});

test("a drop made offline shows at once and is sent when the connection is back", async ({ page, context }) => {
  await seed(page, ["Alpha", "Bravo", "Charlie"]);
  await openLog(page);
  await context.setOffline(true);
  await holdAndDrag(page, "Alpha", "Charlie", 0.8);
  await expect(shown(page)).toHaveText(["Bravo", "Charlie", "Alpha"]);
  await context.setOffline(false);
  await expect.poll(() => stored(page)).toEqual(["Bravo", "Charlie", "Alpha"]);
  await expect(shown(page)).toHaveText(["Bravo", "Charlie", "Alpha"]);
});
