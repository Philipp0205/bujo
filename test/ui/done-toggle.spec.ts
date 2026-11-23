import { expect, test, type Page } from "@playwright/test";
import { useBujo } from "./harness.ts";

const app = useBujo();

test.beforeEach(async ({ page }) => {
  await app.signIn(page);
  // The install banner and the what's new sheet would sit over the log, so both are out of the way before any page script runs.
  await page.addInitScript(() => sessionStorage.setItem("ak-install-prompt-dismissed", "1"));
  await page.request.put(`${app.baseUrl}/api/whats-new/seen`, { data: { id: "2026-11-23-one-tap" } });
});

/** The entries this spec made in its own throwaway database, removed after each test so every test starts from an empty log. */
const made: string[] = [];

test.afterEach(async ({ page }) => {
  await page.context().setOffline(false);
  for (const id of made.splice(0)) await page.request.delete(`${app.baseUrl}/api/entries/${id}`);
});

/** Today as YYYY-MM-DD in the local time zone, which is the day the page shows. */
function today(): string {
  const date = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** A fake entry through the API with the page's session. Never a real list. */
async function seed(page: Page, type: string, title: string): Promise<string> {
  const response = await page.request.post(`${app.baseUrl}/api/entries`, { data: { date: today(), type, title } });
  expect(response.status()).toBe(201);
  const id: string = (await response.json()).entry.id;
  made.push(id);
  return id;
}

/** The type the server holds for an entry, read from its day (there is no route for one entry). */
async function serverType(page: Page, id: string): Promise<string> {
  const response = await page.request.get(`${app.baseUrl}/api/entries?from=${today()}&to=${today()}`);
  const entries: Array<{ id: string; type: string }> = (await response.json()).entries;
  return entries.find((entry) => entry.id === id)?.type ?? "missing";
}

const row = (page: Page, title: string) => page.locator(".paper-row", { hasText: title });
const bullet = (page: Page, title: string) => row(page, title).getByTestId("toggle-done");

/** Opens the log and waits until its scripts are wired, so a tap or a swipe is heard. */
async function openLog(page: Page): Promise<void> {
  await page.goto(app.baseUrl);
  await expect(page.getByRole("heading", { name: "Daily Log", level: 1 })).toBeVisible();
  await page.waitForFunction(() => !!document.querySelector(".paper-add"));
}

/** A swipe right across a row with the mouse, starting clear of the screen edge. */
async function swipeRight(page: Page, title: string, dx = 140, dy = 0): Promise<void> {
  const box = (await row(page, title).boundingBox())!;
  const x = box.x + 60;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
}

test("a tap on the bullet turns a task done, and again turns it back", async ({ page }) => {
  const id = await seed(page, "task", "Brot kaufen");
  await openLog(page);
  await expect(row(page, "Brot kaufen")).toHaveAttribute("data-type", "task");
  await expect(bullet(page, "Brot kaufen")).toHaveAttribute("aria-label", "Mark as done");

  await bullet(page, "Brot kaufen").click();
  await expect(row(page, "Brot kaufen")).toHaveAttribute("data-type", "done");
  await expect(bullet(page, "Brot kaufen")).toHaveAttribute("aria-label", "Mark as not done");
  await expect.poll(() => serverType(page, id)).toBe("done");
  await expect(page.getByTestId("edit-sheet")).toBeHidden();

  await bullet(page, "Brot kaufen").click();
  await expect(row(page, "Brot kaufen")).toHaveAttribute("data-type", "task");
  await expect.poll(() => serverType(page, id)).toBe("task");
});

test("a tap on the title still opens the entry, and the bullet of an event or a note does not toggle", async ({ page }) => {
  await seed(page, "task", "Aufgabe");
  const event = await seed(page, "event", "Zahnarzt");
  const note = await seed(page, "note", "Gedanke");
  await openLog(page);
  await expect(row(page, "Zahnarzt").getByTestId("toggle-done")).toHaveCount(0);
  await expect(row(page, "Gedanke").getByTestId("toggle-done")).toHaveCount(0);

  await row(page, "Zahnarzt").locator(".paper-sym").click({ force: true });
  await row(page, "Gedanke").locator(".paper-sym").click({ force: true });
  expect(await serverType(page, event)).toBe("event");
  expect(await serverType(page, note)).toBe("note");

  await row(page, "Aufgabe").locator(".paper-title").click();
  await expect(page.getByTestId("edit-sheet")).toBeVisible();
  await expect(row(page, "Aufgabe")).toHaveAttribute("data-type", "task");
});

test("a swipe right on an open task no longer marks it done: it opens the migrate chooser instead", async ({ page }) => {
  const id = await seed(page, "task", "Wischen");
  await openLog(page);

  await swipeRight(page, "Wischen");
  await expect(page.getByTestId("move-chooser")).toHaveAttribute("data-kind", "migrate");
  await expect(row(page, "Wischen")).toHaveAttribute("data-type", "task");
  expect(await serverType(page, id)).toBe("task");
  await expect(page.getByTestId("edit-sheet")).toBeHidden();
});

test("a swipe on a done row or an event row does nothing", async ({ page }) => {
  const done = await seed(page, "done", "Fertig");
  const id = await seed(page, "event", "Konzert");
  await openLog(page);
  await swipeRight(page, "Fertig");
  await swipeRight(page, "Konzert");
  await expect(page.getByTestId("move-chooser")).toHaveCount(0);
  await expect(row(page, "Konzert")).toHaveAttribute("data-type", "event");
  expect(await serverType(page, id)).toBe("event");
  expect(await serverType(page, done)).toBe("done");
});

test("a toggle made offline shows at once and is sent when the connection is back", async ({ page }) => {
  const id = await seed(page, "task", "Offline erledigt");
  await openLog(page);
  await page.context().setOffline(true);
  await expect(page.getByTestId("offline-hint")).toBeVisible();

  await bullet(page, "Offline erledigt").click();
  await expect(row(page, "Offline erledigt")).toHaveAttribute("data-type", "done");
  // The test's own request client is not cut off by the page going offline, so it can show the server has not heard of it yet.
  expect(await serverType(page, id)).toBe("task");

  await page.context().setOffline(false);
  await expect.poll(() => serverType(page, id)).toBe("done");
  await expect(row(page, "Offline erledigt")).toHaveAttribute("data-type", "done");
});

test("a refused change puts the row back and says so", async ({ page }) => {
  const id = await seed(page, "task", "Abgelehnt");
  await openLog(page);
  await page.route(`**/api/entries/${id}`, (route) => (route.request().method() === "PATCH" ? route.fulfill({ status: 400, contentType: "application/json", body: "{}" }) : route.continue()));

  await bullet(page, "Abgelehnt").click();
  await expect(row(page, "Abgelehnt")).toHaveAttribute("data-type", "task");
  await expect(page.getByTestId("copy-failed-toast")).toHaveText("Could not do that. Try again.");
  expect(await serverType(page, id)).toBe("task");
});
