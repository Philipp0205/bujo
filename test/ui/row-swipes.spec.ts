import { expect, test, type Page } from "@playwright/test";
import { useBujo } from "./harness.ts";

const app = useBujo();

test.beforeEach(async ({ page }) => {
  await app.signIn(page);
  await page.addInitScript(() => sessionStorage.setItem("ak-install-prompt-dismissed", "1"));
  await page.request.put(`${app.baseUrl}/api/whats-new/seen`, { data: { id: "2026-11-23-paper-order" } });
});

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

/** A fake entry through the API with the page's session. */
async function seed(page: Page, type: string, title: string): Promise<string> {
  const response = await page.request.post(`${app.baseUrl}/api/entries`, { data: { date: today(), type, title } });
  expect(response.status()).toBe(201);
  const id: string = (await response.json()).entry.id;
  made.push(id);
  return id;
}

/** The entry the server holds for today, or undefined once it has left today's page (there is no route for one entry). */
async function serverEntry(page: Page, id: string): Promise<{ type: string; date: string } | undefined> {
  const response = await page.request.get(`${app.baseUrl}/api/entries?from=${today()}&to=${today()}`);
  return ((await response.json()).entries as Array<{ id: string; type: string; date: string }>).find((entry) => entry.id === id);
}

const row = (page: Page, title: string) => page.locator(".paper-row", { hasText: title });
const chooser = (page: Page) => page.getByTestId("move-chooser");

async function openLog(page: Page): Promise<void> {
  await page.goto(app.baseUrl);
  await expect(page.getByRole("heading", { name: "Daily Log", level: 1 })).toBeVisible();
  await page.waitForFunction(() => !!document.querySelector(".paper-add"));
}

/** A drag across a row with the mouse (negative dx is left), released unless hold is true. */
async function drag(page: Page, title: string, dx: number, dy = 0, hold = false): Promise<void> {
  const box = (await row(page, title).boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  if (!hold) await page.mouse.up();
}

test("a swipe right on an open task opens the migrate chooser, not the editor, and marks nothing", async ({ page }) => {
  const id = await seed(page, "task", "Rechts");
  await openLog(page);
  await drag(page, "Rechts", 140);
  await expect(chooser(page)).toHaveAttribute("data-kind", "migrate");
  await expect(page.getByTestId("edit-sheet")).toBeHidden();
  await expect(row(page, "Rechts")).toHaveAttribute("data-type", "task");
  expect((await serverEntry(page, id))?.type).toBe("task");
});

test("a swipe left opens the schedule chooser with the month chips", async ({ page }) => {
  await seed(page, "task", "Links");
  await openLog(page);
  await drag(page, "Links", -140);
  await expect(chooser(page)).toHaveAttribute("data-kind", "schedule");
  await expect(chooser(page).locator(".move-chip").first()).toBeVisible();
});

test("a pick in the swipe chooser moves the entry, and a close without a pick changes nothing", async ({ page }) => {
  const id = await seed(page, "task", "Verschieben");
  await openLog(page);
  await drag(page, "Verschieben", -140);
  await page.getByTestId("move-overlay").click({ position: { x: 4, y: 4 } });
  await expect(chooser(page)).toHaveCount(0);
  expect((await serverEntry(page, id))?.type).toBe("task");

  await drag(page, "Verschieben", -140);
  await chooser(page).locator(".move-chip").first().click();
  await expect.poll(async () => await serverEntry(page, id)).toBeUndefined();
});

test("a short drag, a mostly vertical drag and a release below the threshold do nothing", async ({ page }) => {
  await seed(page, "task", "Kurz");
  await openLog(page);
  await drag(page, "Kurz", 30);
  await drag(page, "Kurz", 80, 90);
  await drag(page, "Kurz", -50);
  await expect(chooser(page)).toHaveCount(0);
  await expect(row(page, "Kurz")).toHaveAttribute("data-type", "task");
  await expect(row(page, "Kurz")).toHaveCSS("transform", "none");
});

test("the row follows the finger while held and snaps back on a cancelled release", async ({ page }) => {
  await seed(page, "task", "Halten");
  await openLog(page);
  await drag(page, "Halten", 40, 0, true);
  await expect(row(page, "Halten").locator(".swipe-ink-migrate")).toHaveCount(1);
  await expect(row(page, "Halten")).not.toHaveCSS("transform", "none");
  await page.mouse.up();
  await expect(chooser(page)).toHaveCount(0);
  await expect(row(page, "Halten").locator(".swipe-ink")).toHaveCount(0);
});

test("a note, an event and a done row do not open the chooser", async ({ page }) => {
  await seed(page, "note", "Gedanke");
  await seed(page, "event", "Termin");
  await seed(page, "done", "Fertig");
  await openLog(page);
  for (const title of ["Gedanke", "Termin", "Fertig"]) {
    await drag(page, title, 140);
    await drag(page, title, -140);
  }
  await expect(chooser(page)).toHaveCount(0);
});

test("a swipe on empty paper still turns the page", async ({ page }) => {
  await seed(page, "task", "Heute");
  const later = new Date();
  later.setDate(later.getDate() + 2);
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${later.getFullYear()}-${pad(later.getMonth() + 1)}-${pad(later.getDate())}`;
  const response = await page.request.post(`${app.baseUrl}/api/entries`, { data: { date, type: "task", title: "Spaeter" } });
  made.push((await response.json()).entry.id);
  await openLog(page);

  const body = page.locator(".page-body");
  const box = (await body.boundingBox())!;
  const x = box.x + box.width - 60;
  const y = box.y + box.height - 40;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 70, y, { steps: 4 });
  await page.mouse.move(x - 140, y, { steps: 4 });
  await page.mouse.up();
  await expect(body).toHaveAttribute("data-date", date);
  await expect(chooser(page)).toHaveCount(0);
});
