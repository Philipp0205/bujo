import { expect, test, type Page } from "@playwright/test";
import { useBujo } from "./harness.ts";

const app = useBujo();

test.beforeEach(async ({ page }) => {
  await app.signIn(page);
  // The install banner and the what's new sheet would sit over the log, so both are out of the way before any page script runs.
  await page.addInitScript(() => sessionStorage.setItem("ak-install-prompt-dismissed", "1"));
  await page.request.put(`${app.baseUrl}/api/whats-new/seen`, { data: { id: "2026-11-23-fonts" } });
});

/** The entries this spec made in its own throwaway database, removed after each test (their traces go with them). */
const made: string[] = [];

test.afterEach(async ({ page }) => {
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

/** The entry the server holds for today, or undefined once it has left today's page. */
async function serverEntry(page: Page, id: string): Promise<{ type: string; date: string } | undefined> {
  const response = await page.request.get(`${app.baseUrl}/api/entries?from=${today()}&to=${today()}`);
  return ((await response.json()).entries as Array<{ id: string; type: string; date: string }>).find((entry) => entry.id === id);
}

const row = (page: Page, title: string) => page.locator(".paper-row", { hasText: title });
const marker = (page: Page, title: string) => row(page, title).locator(".paper-sym");
const picker = (page: Page) => page.getByTestId("type-chooser");
const chooser = (page: Page) => page.getByTestId("move-chooser");

async function openLog(page: Page): Promise<void> {
  await page.goto(app.baseUrl);
  await expect(page.getByRole("heading", { name: "Daily Log", level: 1 })).toBeVisible();
  await page.waitForFunction(() => !!document.querySelector(".paper-add"));
}

/** A long press with the mouse on a locator: press, hold past the hold time, release. */
async function hold(page: Page, target: ReturnType<typeof marker>): Promise<void> {
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
}

test("a short tap on the marker marks the task done, and a second tap turns it back, with no picker and no editor", async ({ page }) => {
  const id = await seed(page, "task", "Tippen");
  await openLog(page);

  await marker(page, "Tippen").click();
  await expect(row(page, "Tippen")).toHaveAttribute("data-type", "done");
  await expect(picker(page)).toHaveCount(0);
  await expect(page.getByTestId("edit-sheet")).toBeHidden();
  await expect.poll(async () => (await serverEntry(page, id))?.type).toBe("done");

  await marker(page, "Tippen").click();
  await expect(row(page, "Tippen")).toHaveAttribute("data-type", "task");
  await expect(picker(page)).toHaveCount(0);
});

test("a long press on the marker opens every writer-facing type, starts no select mode and does not toggle", async ({ page }) => {
  const id = await seed(page, "task", "Halten");
  await openLog(page);

  await hold(page, marker(page, "Halten"));
  await expect(picker(page)).toBeVisible();
  const types = await picker(page).locator(".type-option").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-type")));
  expect(types).toEqual(["task", "done", "migrated", "scheduled", "event", "note"]);
  await expect(picker(page).locator(".type-option-label")).toHaveText(["Task", "Done", "Moved", "Scheduled", "Event", "Note"]);
  await expect(page.getByTestId("select-bar")).toHaveCount(0);
  await expect(page.getByTestId("select-check")).toHaveCount(0);
  await expect(page.getByTestId("edit-sheet")).toBeHidden();
  await expect(row(page, "Halten")).toHaveAttribute("data-type", "task");
  expect((await serverEntry(page, id))?.type).toBe("task");

  await page.mouse.click(5, 400);
  await expect(picker(page)).toHaveCount(0);
  await expect(row(page, "Halten")).toHaveAttribute("data-type", "task");
});

test("a long press on the title still starts select mode and opens no picker", async ({ page }) => {
  await seed(page, "task", "Titel");
  await openLog(page);

  await hold(page, row(page, "Titel").locator(".paper-title"));
  await expect(row(page, "Titel").getByTestId("select-check")).toHaveAttribute("data-checked", "true");
  await expect(picker(page)).toHaveCount(0);
});

test("picking Moved opens the move chooser, and closing it with no pick leaves the task as it was", async ({ page }) => {
  const id = await seed(page, "task", "Verschieben");
  await openLog(page);

  await hold(page, marker(page, "Verschieben"));
  await picker(page).locator('[data-type="migrated"]').click();
  await expect(picker(page)).toHaveCount(0);
  await expect(chooser(page)).toHaveAttribute("data-kind", "migrate");

  await page.mouse.click(5, 400);
  await expect(chooser(page)).toHaveCount(0);
  await expect(row(page, "Verschieben")).toHaveAttribute("data-type", "task");
  expect((await serverEntry(page, id))?.type).toBe("task");
});

test("picking Scheduled and then a day moves the entry and leaves a trace, with the same id", async ({ page }) => {
  const id = await seed(page, "task", "Planen");
  await openLog(page);

  await hold(page, marker(page, "Planen"));
  await picker(page).locator('[data-type="scheduled"]').click();
  await expect(chooser(page)).toHaveAttribute("data-kind", "schedule");
  await chooser(page).locator(".move-chip").first().click();
  await expect(page.getByTestId("trace-row")).toHaveAttribute("data-trace", "scheduled");
  expect(await serverEntry(page, id)).toBeUndefined();
});

test("picking Event, Note or Done applies the type", async ({ page }) => {
  const event = await seed(page, "task", "Termin");
  const note = await seed(page, "task", "Notiz");
  const done = await seed(page, "task", "Erledigt");
  await openLog(page);

  await hold(page, marker(page, "Termin"));
  await picker(page).locator('[data-type="event"]').click();
  await expect(row(page, "Termin")).toHaveAttribute("data-type", "event");
  await expect.poll(async () => (await serverEntry(page, event))?.type).toBe("event");

  await hold(page, marker(page, "Notiz"));
  await picker(page).locator('[data-type="note"]').click();
  await expect(row(page, "Notiz")).toHaveAttribute("data-type", "note");
  await expect.poll(async () => (await serverEntry(page, note))?.type).toBe("note");

  await hold(page, marker(page, "Erledigt"));
  await picker(page).locator('[data-type="done"]').click();
  await expect(row(page, "Erledigt")).toHaveAttribute("data-type", "done");
  await expect.poll(async () => (await serverEntry(page, done))?.type).toBe("done");
});

test("a swipe that starts on the marker is a swipe, not a hold: it opens the migrate chooser and no picker", async ({ page }) => {
  await seed(page, "task", "Wischen");
  await openLog(page);

  const box = (await marker(page, "Wischen").boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 70, y, { steps: 4 });
  await page.mouse.move(x + 140, y, { steps: 4 });
  await page.mouse.up();
  await expect(chooser(page)).toHaveAttribute("data-kind", "migrate");
  await expect(picker(page)).toHaveCount(0);
});
