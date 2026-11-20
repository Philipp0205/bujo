import { expect, test, type Page } from "@playwright/test";
import { useBujo } from "./harness.ts";

const app = useBujo();

test.beforeEach(async ({ page }) => {
  await app.signIn(page);
});

/** A calendar day as YYYY-MM-DD in the local time zone, n days from today (the page uses the local day too). */
function day(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The heading the page shows for a day: English weekday and German dd.mm. */
function heading(iso: string): string {
  const [year, month, dayOfMonth] = iso.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, dayOfMonth)).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
  return `${weekday} ${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
}

type Seed = { date: string; type: string; title: string; tag?: string; time?: string };

/** Creates fake entries through the API with the page's session. Never touches a real list. */
async function seed(page: Page, entries: Seed[]): Promise<void> {
  for (const entry of entries) {
    const response = await page.request.post(`${app.baseUrl}/api/entries`, { data: entry });
    expect(response.status()).toBe(201);
  }
}

const row = (page: Page, title: string) => page.locator(".paper-row", { hasText: title });

test("without a session the rapid log sends you to sign in", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(app.baseUrl);
  await expect(page).toHaveURL(/\/signin$/);
  await context.close();
});

test("an empty log shows today with its mark and the add row, and no scan or settings error", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(app.baseUrl);

  await expect(page.getByRole("heading", { name: "Rapid Log", level: 1 })).toBeVisible();
  const today = page.locator(`.paper-day[data-date="${day(0)}"]`);
  await expect(today).toContainText(heading(day(0)));
  await expect(today.locator("[data-testid=today-mark]")).toHaveText("Today");
  await expect(page.locator("[data-testid=today-mark]")).toHaveCount(1);
  await expect(page.locator("[data-action=add-entry]")).toHaveText("+ Add entry");

  const scan = page.getByRole("button", { name: "Scan a page" });
  await expect(scan).toBeDisabled();
  await expect(scan).toHaveAttribute("title", "Scan comes later");
  await expect(page.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  expect(errors).toEqual([]);
});

test("entries are grouped under day headers with glyph, tag, time and sync dot", async ({ page }) => {
  await seed(page, [
    { date: day(-1), type: "done", title: "Gestern erledigt", tag: "Arbeit" },
    { date: day(-1), type: "migrated", title: "Gestern verschoben" },
    { date: day(0), type: "task", title: "Heute Aufgabe", tag: "Haushalt" },
    { date: day(0), type: "event", title: "Mittagessen im Café Linde", tag: "Freizeit", time: "13:00" },
    { date: day(0), type: "note", title: "Küchengarten, Frühjahr" },
    { date: day(1), type: "scheduled", title: "Vermieter anrufen" },
    { date: day(-30), type: "task", title: "Viel zu alt" },
    { date: day(30), type: "task", title: "Viel zu weit weg" },
  ]);
  await page.goto(app.baseUrl);
  await expect(row(page, "Heute Aufgabe")).toBeVisible();

  // Headers: yesterday, today, tomorrow, in date order. Days outside the window are not shown.
  await expect(page.locator(".paper-day")).toHaveText([
    heading(day(-1)),
    new RegExp(`^${heading(day(0))}\\s*Today$`),
    heading(day(1)),
  ]);
  await expect(row(page, "Viel zu alt")).toHaveCount(0);
  await expect(row(page, "Viel zu weit weg")).toHaveCount(0);

  // Rows sit under their own day, and each type has its glyph from the sprite.
  const yesterday = page.locator(`.paper-day-group[data-date="${day(-1)}"]`);
  await expect(yesterday.locator(".paper-row")).toHaveCount(2);
  const glyph = (title: string) => row(page, title).locator(".paper-sym use").getAttribute("href");
  expect(await glyph("Gestern erledigt")).toBe("#g-done");
  expect(await glyph("Gestern verschoben")).toBe("#g-moved");
  expect(await glyph("Heute Aufgabe")).toBe("#g-task");
  expect(await glyph("Mittagessen")).toBe("#g-event");
  expect(await glyph("Küchengarten")).toBe("#g-note");
  expect(await glyph("Vermieter")).toBe("#g-sched");

  // Meta line: the tag, then the time, or "not synced" when a local entry has no tag. The dot says local.
  await expect(row(page, "Heute Aufgabe").locator(".meta-text")).toHaveText("Haushalt");
  await expect(row(page, "Mittagessen").locator(".meta-text")).toHaveText("Freizeit \u00b7 13:00");
  await expect(row(page, "Küchengarten").locator(".meta-text")).toHaveText("not synced");
  await expect(row(page, "Küchengarten").locator(".sync-mark")).toHaveAttribute("data-sync", "local");
  await expect(row(page, "Gestern erledigt")).toHaveAttribute("data-type", "done");
  await expect(row(page, "Gestern erledigt").locator(".paper-title")).toHaveCSS("text-decoration-line", "line-through");
  await expect(row(page, "Gestern verschoben")).toHaveCSS("opacity", "0.55");
});

test("the paper is the mock's solid dot grid in the page colour, never white", async ({ page }, testInfo) => {
  await page.goto(app.baseUrl);
  await expect(page.locator("[data-testid=today-mark]")).toBeVisible();
  const dark = testInfo.project.name === "phone-dark";
  const paper = await page.locator(".paper").evaluate((el) => {
    const style = getComputedStyle(el);
    return { bg: style.backgroundColor, image: style.backgroundImage, size: style.backgroundSize };
  });
  expect(paper.bg).toBe(dark ? "rgb(22, 19, 15)" : "rgb(244, 239, 228)");
  expect(paper.image).toContain("radial-gradient");
  expect(paper.size).toContain("24px 24px");
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(dark ? "rgb(22, 19, 15)" : "rgb(244, 239, 228)");
});

test("add an entry through the sheet: today and task are preselected", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(app.baseUrl);
  await page.locator("[data-action=add-entry]").click();

  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: "New entry" })).toBeVisible();
  await expect(sheet.locator("[data-testid=sheet-date]")).toHaveText(heading(day(0)));
  await expect(sheet.locator('.type-btn[aria-pressed="true"]')).toHaveText("Task");
  await expect(sheet.locator(".type-btn")).toHaveText(["Task", "Note", "Event", "Done", "Moved", "Scheduled"]);
  await expect(sheet.locator('input[name="date"]')).toHaveValue(day(0));
  await expect(sheet.getByTestId("sync-line")).toContainText("Not synced");

  // An empty title is refused in the sheet, nothing is sent.
  await sheet.locator("[data-action=save]").click();
  await expect(sheet.getByRole("alert")).toContainText("Give the entry a title.");

  await sheet.locator(".type-btn", { hasText: "Event" }).click();
  await sheet.locator('input[name="title"]').fill("  Zahnarzt  ");
  await sheet.locator('input[name="tag"]').fill("Gesundheit");
  await sheet.locator('input[name="time"]').fill("09:30");
  await sheet.locator("[data-action=save]").click();

  await expect(page.getByRole("dialog")).toHaveCount(0);
  const created = row(page, "Zahnarzt");
  await expect(created).toHaveAttribute("data-type", "event");
  await expect(created.locator(".paper-title")).toHaveText("Zahnarzt");
  await expect(created.locator(".meta-text")).toHaveText("Gesundheit \u00b7 09:30");
  await expect(page.locator(`.paper-day-group[data-date="${day(0)}"] .paper-row`, { hasText: "Zahnarzt" })).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("a server error stays inside the open sheet", async ({ page }) => {
  await page.goto(app.baseUrl);
  await page.route("**/api/entries", (route) =>
    route.request().method() === "POST" ? route.fulfill({ status: 400, json: { error: "title is too long (at most 200 characters)" } }) : route.continue(),
  );
  await page.locator("[data-action=add-entry]").click();
  const sheet = page.getByRole("dialog");
  await sheet.locator('input[name="title"]').fill("Zu lang");
  await sheet.locator("[data-action=save]").click();

  await expect(sheet.getByRole("alert")).toContainText("title is too long");
  await expect(sheet.locator("[data-action=save]")).toBeEnabled();
  await expect(sheet.locator('input[name="title"]')).toHaveValue("Zu lang");
});

test("tap a row to edit it: the sheet shows its values and Save changes them", async ({ page }) => {
  await seed(page, [{ date: day(0), type: "task", title: "Kaffeebohnen bestellen", tag: "Haushalt" }]);
  await page.goto(app.baseUrl);
  await row(page, "Kaffeebohnen").click();

  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: "Edit entry" })).toBeVisible();
  await expect(sheet.locator("[data-testid=sheet-date]")).toHaveText(heading(day(0)));
  await expect(sheet.locator('.type-btn[aria-pressed="true"]')).toHaveText("Task");
  await expect(sheet.locator('input[name="title"]')).toHaveValue("Kaffeebohnen bestellen");
  await expect(sheet.locator('input[name="tag"]')).toHaveValue("Haushalt");
  await expect(sheet.getByTestId("sync-line")).toContainText("Not synced");

  await sheet.locator(".type-btn", { hasText: "Done" }).click();
  await sheet.locator('input[name="title"]').fill("Kaffeebohnen bestellt");
  await sheet.locator('input[name="tag"]').fill("");
  await sheet.locator('input[name="date"]').fill(day(1));
  await sheet.locator("[data-action=save]").click();

  await expect(page.getByRole("dialog")).toHaveCount(0);
  const moved = page.locator(`.paper-day-group[data-date="${day(1)}"] .paper-row`, { hasText: "Kaffeebohnen bestellt" });
  await expect(moved).toHaveAttribute("data-type", "done");
  await expect(moved.locator(".meta-text")).toHaveText("not synced");
  await expect(page.locator(`.paper-day-group[data-date="${day(0)}"] .paper-row`, { hasText: "Kaffeebohnen" })).toHaveCount(0);
});

test("Escape and a tap on the scrim close the sheet without saving", async ({ page }) => {
  await seed(page, [{ date: day(0), type: "note", title: "Bleibt wie es ist" }]);
  await page.goto(app.baseUrl);

  await row(page, "Bleibt wie es ist").click();
  await page.getByRole("dialog").locator('input[name="title"]').fill("Nicht gespeichert");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(row(page, "Bleibt wie es ist")).toBeVisible();

  await row(page, "Bleibt wie es ist").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.locator(".ak-scrim").click({ position: { x: 195, y: 20 } });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(row(page, "Nicht gespeichert")).toHaveCount(0);
});

test("a failing list shows a quiet error with a retry", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/entries?*", (route) => {
    calls += 1;
    return calls === 1 ? route.fulfill({ status: 500, json: { error: "boom" } }) : route.continue();
  });
  await page.goto(app.baseUrl);
  await expect(page.locator('[data-state="error"]')).toContainText("Could not load the log");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator("[data-testid=today-mark]")).toBeVisible();
});

test("settings links to the rapid log and the backlog", async ({ page }) => {
  await page.goto(`${app.baseUrl}/settings`);
  await expect(page.locator('[data-nav="log"]')).toHaveAttribute("href", "/");
  await expect(page.locator('[data-nav="backlog"]')).toHaveAttribute("href", "/backlog");
});
