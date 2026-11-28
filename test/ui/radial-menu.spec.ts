import { expect, test, type Locator, type Page } from "@playwright/test";
import { pinClock, pinnedDay, useBujo, WHATS_NEW_NEWEST } from "./harness.ts";

const app = useBujo();

test.beforeEach(async ({ page }) => {
  await pinClock(page);
  await app.signIn(page);
  await page.addInitScript(() => sessionStorage.setItem("ak-install-prompt-dismissed", "1"));
  await page.request.put(`${app.baseUrl}/api/whats-new/seen`, { data: { id: WHATS_NEW_NEWEST } });
});

/** The entries this spec made in its own throwaway database, removed after each test. */
const made: string[] = [];

test.afterEach(async ({ page }) => {
  for (const id of made.splice(0)) await page.request.delete(`${app.baseUrl}/api/entries/${id}`);
});

const today = () => pinnedDay(0);

/** A fake entry through the API with the page's session. Never a real list. */
async function seed(page: Page, type: string, title: string): Promise<string> {
  const response = await page.request.post(`${app.baseUrl}/api/entries`, { data: { date: today(), type, title } });
  expect(response.status()).toBe(201);
  const id: string = (await response.json()).entry.id;
  made.push(id);
  return id;
}

/** The entry the server holds for today, or undefined. */
async function serverEntry(page: Page, id: string): Promise<{ type: string; date: string } | undefined> {
  const response = await page.request.get(`${app.baseUrl}/api/entries?from=${today()}&to=${today()}`);
  return ((await response.json()).entries as Array<{ id: string; type: string; date: string }>).find((entry) => entry.id === id);
}

const row = (page: Page, title: string) => page.locator(".paper-row", { hasText: title });
const menu = (page: Page) => page.getByTestId("radial-menu");
const bubble = (page: Page, action: string) => page.getByTestId(`radial-${action}`);

async function openLog(page: Page): Promise<void> {
  await page.goto(app.baseUrl);
  await expect(page.getByRole("heading", { name: "Daily Log", level: 1 })).toBeVisible();
  await page.waitForFunction(() => !!document.querySelector(".paper-add"));
  await page.waitForLoadState("networkidle");
}

/** The middle of a locator, on the title side (clear of the marker, which has its own long press). */
async function pressPoint(target: Locator): Promise<{ x: number; y: number }> {
  const box = (await target.boundingBox())!;
  return { x: box.x + box.width * 0.6, y: box.y + box.height / 2 };
}

/** A long press with the mouse: press, hold past the hold time, release in place. */
async function hold(page: Page, target: Locator): Promise<void> {
  const at = await pressPoint(target);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
}

/** The centre of a bubble. */
async function centreOf(target: Locator): Promise<{ x: number; y: number }> {
  const box = (await target.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test("a long press on a row opens the ring with every action of an open task", async ({ page }) => {
  await seed(page, "task", "Kreis");
  await openLog(page);
  await hold(page, row(page, "Kreis"));

  await expect(menu(page)).toBeVisible();
  const actions = await menu(page).locator(".radial-bubble").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-action")));
  expect(actions).toEqual(["done", "migrate", "schedule", "edit", "type", "select"]);
  await expect(menu(page).locator(".radial-label")).toHaveText(["done", "migrate", "schedule", "edit", "type", "select"]);
  await expect(page.getByTestId("radial-planet")).toContainText("Kreis");
  // Letting go did not open the editor or tick the task.
  await expect(page.getByTestId("edit-sheet")).toBeHidden();
  await expect(row(page, "Kreis")).toHaveAttribute("data-type", "task");
});

test("a note offers edit, type, drop and select only", async ({ page }) => {
  await seed(page, "note", "Nur Notiz");
  await openLog(page);
  await hold(page, row(page, "Nur Notiz"));
  const actions = await menu(page).locator(".radial-bubble").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-action")));
  expect(actions).toEqual(["edit", "type", "drop", "select"]);
});

test("the done bubble ticks the task and closes the menu", async ({ page }) => {
  const id = await seed(page, "task", "Abhaken");
  await openLog(page);
  await hold(page, row(page, "Abhaken"));
  await bubble(page, "done").click();

  await expect(menu(page)).toHaveCount(0);
  await expect(row(page, "Abhaken")).toHaveAttribute("data-type", "done");
  await expect.poll(async () => (await serverEntry(page, id))?.type).toBe("done");
});

test("the edit bubble opens the edit sheet", async ({ page }) => {
  await seed(page, "task", "Bearbeiten");
  await openLog(page);
  await hold(page, row(page, "Bearbeiten"));
  await bubble(page, "edit").click();
  await expect(menu(page)).toHaveCount(0);
  await expect(page.getByTestId("edit-sheet")).toBeVisible();
});

test("the type bubble opens the type picker, the migrate bubble the move chooser", async ({ page }) => {
  await seed(page, "task", "Umtypen");
  await openLog(page);
  await hold(page, row(page, "Umtypen"));
  await bubble(page, "type").click();
  await expect(page.getByTestId("type-chooser")).toBeVisible();
  await page.mouse.click(5, 400);
  await expect(page.getByTestId("type-chooser")).toHaveCount(0);

  await hold(page, row(page, "Umtypen"));
  await bubble(page, "migrate").click();
  await expect(page.getByTestId("move-chooser")).toHaveAttribute("data-kind", "migrate");
});

test("the select bubble starts select mode with that row ticked", async ({ page }) => {
  await seed(page, "task", "Auswahl");
  await openLog(page);
  await hold(page, row(page, "Auswahl"));
  await bubble(page, "select").click();
  await expect(page.getByTestId("select-bar")).toBeVisible();
  await expect(page.getByTestId("select-count")).toHaveText("1 selected");
  await expect(row(page, "Auswahl")).toHaveAttribute("aria-selected", "true");
});

test("the drop bubble strikes a note out", async ({ page }) => {
  const id = await seed(page, "note", "Streichen");
  await openLog(page);
  await hold(page, row(page, "Streichen"));
  await bubble(page, "drop").click();
  await expect(row(page, "Streichen")).toHaveAttribute("data-type", "dropped");
  await expect.poll(async () => (await serverEntry(page, id))?.type).toBe("dropped");
});

test("press, drag onto a bubble and let go runs it", async ({ page }) => {
  const id = await seed(page, "task", "Ziehen");
  await openLog(page);
  const at = await pressPoint(row(page, "Ziehen"));
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await expect(menu(page)).toBeVisible();
  const target = await centreOf(bubble(page, "done"));
  await page.mouse.move(target.x, target.y, { steps: 5 });
  await expect(bubble(page, "done")).toHaveClass(/is-hot/);
  await page.mouse.up();

  await expect(menu(page)).toHaveCount(0);
  await expect.poll(async () => (await serverEntry(page, id))?.type).toBe("done");
});

test("press, drag onto nothing and let go closes the menu and runs nothing", async ({ page }) => {
  await seed(page, "task", "Daneben");
  await openLog(page);
  const at = await pressPoint(row(page, "Daneben"));
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await expect(menu(page)).toBeVisible();
  await page.mouse.move(8, 8, { steps: 5 });
  await page.mouse.up();
  await expect(menu(page)).toHaveCount(0);
  await expect(row(page, "Daneben")).toHaveAttribute("data-type", "task");
});

test("a tap outside, Escape and Back each close the menu", async ({ page }) => {
  await seed(page, "task", "Schliessen");
  await openLog(page);

  await hold(page, row(page, "Schliessen"));
  await expect(menu(page)).toBeVisible();
  await page.mouse.click(5, 300);
  await expect(menu(page)).toHaveCount(0);

  await hold(page, row(page, "Schliessen"));
  await expect(menu(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu(page)).toHaveCount(0);

  await hold(page, row(page, "Schliessen"));
  await expect(menu(page)).toBeVisible();
  await page.goBack();
  await expect(menu(page)).toHaveCount(0);
  await expect(page).toHaveURL(`${app.baseUrl}/`);
  await expect(page.getByRole("heading", { name: "Daily Log", level: 1 })).toBeVisible();
  await expect(row(page, "Schliessen")).toHaveAttribute("data-type", "task");
});

test("moving before the hold time opens no menu", async ({ page }) => {
  await seed(page, "task", "Verwischt");
  await openLog(page);
  const at = await pressPoint(row(page, "Verwischt"));
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x, at.y + 30, { steps: 4 });
  await page.waitForTimeout(650);
  await page.mouse.up();
  await expect(menu(page)).toHaveCount(0);
});

test("a short tap still opens the editor and no menu", async ({ page }) => {
  await seed(page, "task", "Kurz");
  await openLog(page);
  await row(page, "Kurz").click();
  await expect(page.getByTestId("edit-sheet")).toBeVisible();
  await expect(menu(page)).toHaveCount(0);
});

test("a long press on the marker still opens the type picker, not the menu", async ({ page }) => {
  await seed(page, "task", "Marke");
  await openLog(page);
  await hold(page, row(page, "Marke").locator(".paper-sym"));
  await expect(page.getByTestId("type-chooser")).toBeVisible();
  await expect(menu(page)).toHaveCount(0);
});

/** True when every bubble of the open menu lies inside the phone screen and above the tab bar. */
async function ringOnScreen(page: Page): Promise<boolean> {
  const view = page.viewportSize()!;
  const dock = (await page.getByRole("navigation", { name: "Main" }).boundingBox())!;
  const boxes = await menu(page).locator(".radial-bubble").evaluateAll((nodes) => nodes.map((node) => {
    const { left, top, right, bottom } = node.getBoundingClientRect();
    return { left, top, right, bottom };
  }));
  expect(boxes).toHaveLength(6);
  return boxes.every((box) => box.left >= 0 && box.right <= view.width && box.top >= 0 && box.bottom <= dock.y);
}

test("the ring stays on screen for a row near the top and one near the bottom", async ({ page }) => {
  for (let index = 1; index <= 16; index += 1) await seed(page, "task", `Zeile ${String(index).padStart(2, "0")}`);
  await openLog(page);

  await hold(page, row(page, "Zeile 01"));
  await expect(menu(page)).toBeVisible();
  expect(await ringOnScreen(page)).toBe(true);
  await page.keyboard.press("Escape");

  const dock = (await page.getByRole("navigation", { name: "Main" }).boundingBox())!;
  const lowest = await page.locator(".paper-row").evaluateAll((nodes, limit) => {
    const visible = nodes.map((node, index) => ({ index, bottom: node.getBoundingClientRect().bottom })).filter((item) => item.bottom < limit);
    return visible[visible.length - 1].index;
  }, dock.y - 4);
  await hold(page, page.locator(".paper-row").nth(lowest));
  await expect(menu(page)).toBeVisible();
  expect(await ringOnScreen(page)).toBe(true);
});
