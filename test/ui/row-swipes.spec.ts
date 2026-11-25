import { expect, test, type Page } from "@playwright/test";
import { useBujo, WHATS_NEW_NEWEST } from "./harness.ts";

const app = useBujo();

test.beforeEach(async ({ page }) => {
  await app.signIn(page);
  await page.addInitScript(() => sessionStorage.setItem("ak-install-prompt-dismissed", "1"));
  await page.request.put(`${app.baseUrl}/api/whats-new/seen`, { data: { id: WHATS_NEW_NEWEST } });
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
  await expect(row(page, "Kurz")).toHaveCSS("margin-left", "0px");
  expect(await row(page, "Kurz").evaluate((el) => el.getAttribute("style") ?? "")).not.toContain("width");
});

const LONG = "Wrapping title that is long enough to run over three lines on a phone, so the swipe must not push any of its words off the screen";

test("a wrapping title stays on screen mid-swipe in both directions and after the snap back", async ({ page }) => {
  await seed(page, "task", LONG);
  await openLog(page);
  const target = row(page, "Wrapping title");
  const width = page.viewportSize()!.width;
  const rest = (await target.locator(".paper-title").boundingBox())!;
  for (const dx of [-80, 80]) {
    await drag(page, "Wrapping title", dx, 0, true);
    await expect(target.locator(".swipe-ink")).toHaveCount(1);
    const box = (await target.boundingBox())!;
    const title = (await target.locator(".paper-title").boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(title.x).toBeGreaterThanOrEqual(0);
    expect(title.x + title.width).toBeLessThanOrEqual(box.x + box.width);
    await page.mouse.up();
    await expect(target.locator(".swipe-ink")).toHaveCount(0);
    await expect(chooser(page)).toHaveCount(1);
    await page.getByTestId("move-overlay").click({ position: { x: 4, y: 4 } });
    await expect(chooser(page)).toHaveCount(0);
  }
  await expect.poll(async () => (await target.locator(".paper-title").boundingBox())!.height).toBe(rest.height);
  await expect.poll(async () => (await target.locator(".paper-title").boundingBox())!.x).toBe(rest.x);
});

type Box = { x: number; y: number; width: number; height: number };

/** The boxes of the given rows, by title. */
async function boxes(page: Page, titles: string[]): Promise<Box[]> {
  return Promise.all(titles.map(async (title) => (await row(page, title).boundingBox())!));
}

test("a swipe keeps neighbors and the swiped row on their grid position, one-line and wrapping", async ({ page }) => {
  await seed(page, "task", "Oben");
  await seed(page, "task", LONG);
  await seed(page, "task", "Unten");
  await seed(page, "task", "Kurzzeile");
  await openLog(page);
  const titles = ["Oben", "Wrapping title", "Unten", "Kurzzeile"];
  const rest = await boxes(page, titles);
  expect(rest[1].height % 24).toBe(0);
  for (const swiped of [1, 3]) {
    for (const dx of [-90, 90]) {
      await drag(page, titles[swiped], dx, 0, true);
      await expect(row(page, titles[swiped]).locator(".swipe-ink")).toHaveCount(1);
      const mid = await boxes(page, titles);
      titles.forEach((_, i) => {
        if (i === swiped) {
          expect(mid[i].y).toBe(rest[i].y);
          expect(mid[i].height).toBe(rest[i].height);
        } else expect(mid[i]).toEqual(rest[i]);
      });
      await page.mouse.up();
      await page.getByTestId("move-overlay").click({ position: { x: 4, y: 4 } });
      await expect(chooser(page)).toHaveCount(0);
      await page.waitForTimeout(400);
      expect(await boxes(page, titles)).toEqual(rest);
    }
  }
});

test("the row follows the finger while held and snaps back on a cancelled release", async ({ page }) => {
  await seed(page, "task", "Halten");
  await openLog(page);
  await drag(page, "Halten", 40, 0, true);
  await expect(row(page, "Halten").locator(".swipe-ink-migrate")).toHaveCount(1);
  await expect(row(page, "Halten")).toHaveCSS("margin-left", "40px");
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
