import { expect, test, type Page } from "@playwright/test";
import { openDetails, useBujo } from "./harness.ts";

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

test("an empty log shows today with its mark and the add row, the tab bar and no settings link, and no error", async ({ page }) => {
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
  await expect(scan).toBeEnabled();
  await expect(page.locator(".paper-head [data-nav=settings]")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);
  const tabs = page.getByRole("navigation", { name: "Main" });
  await expect(tabs.locator(".ak-tab")).toHaveText(["Rapid log", "Notes", "Account"]);
  await expect(tabs.locator("[data-tab=log]")).toHaveAttribute("aria-current", "page");
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

  // Pills under the title: the tag, then the time, or "not synced" when a local task has no tag. The dot says local.
  // A note is never synced, so it shows no label and no dot.
  await expect(row(page, "Heute Aufgabe").locator(".pill")).toHaveText(["Haushalt"]);
  await expect(row(page, "Mittagessen").locator(".pill")).toHaveText(["Freizeit", "13:00"]);
  await expect(row(page, "Küchengarten")).toHaveAttribute("data-sync", "local");
  await expect(row(page, "Küchengarten").locator(".paper-meta")).toHaveCount(0);
  await expect(row(page, "Küchengarten").locator(".sync-mark")).toHaveCount(0);
  await expect(row(page, "Küchengarten")).not.toContainText("not synced");
  await expect(row(page, "Heute Aufgabe").locator(".sync-mark")).toHaveAttribute("data-sync", "local");
  await expect(row(page, "Gestern erledigt")).toHaveAttribute("data-type", "done");
  await expect(row(page, "Gestern erledigt").locator(".paper-title")).toHaveCSS("text-decoration-line", "line-through");
  await expect(row(page, "Gestern verschoben")).toHaveCSS("opacity", "0.55");
});

test("a note shows no sync label and no dot, a task and an event next to it still do", async ({ page }) => {
  await seed(page, [
    { date: day(0), type: "note", title: "Notiz ohne Tag" },
    { date: day(0), type: "note", title: "Notiz mit Tag", tag: "Garten", time: "08:15" },
    { date: day(0), type: "task", title: "Aufgabe ohne Tag" },
    { date: day(0), type: "event", title: "Termin ohne Tag" },
  ]);
  await page.goto(app.baseUrl);
  await expect(row(page, "Aufgabe ohne Tag")).toBeVisible();

  for (const title of ["Aufgabe ohne Tag", "Termin ohne Tag"]) {
    await expect(row(page, title).locator(".pill")).toHaveText(["not synced"]);
    await expect(row(page, title).locator(".sync-mark")).toHaveAttribute("data-sync", "local");
  }
  await expect(row(page, "Notiz ohne Tag").locator(".pill")).toHaveCount(0);
  await expect(row(page, "Notiz ohne Tag").locator(".sync-mark")).toHaveCount(0);
  await expect(row(page, "Notiz mit Tag").locator(".pill")).toHaveText(["Garten", "08:15"]);
  await expect(row(page, "Notiz mit Tag").locator(".sync-mark")).toHaveCount(0);
  await expect(page.locator('.paper-row[data-type="note"]', { hasText: /not synced/i })).toHaveCount(0);
});

test("the details sheet of a short note has no sync line, and it follows the chosen type", async ({ page }) => {
  await seed(page, [{ date: day(0), type: "note", title: "Kurze Notiz" }]);
  await page.goto(app.baseUrl);
  await openDetails(page, "Kurze Notiz");

  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: "Edit entry" })).toBeVisible();
  await expect(sheet.getByTestId("sync-line")).toHaveCount(0);
  await expect(sheet.locator(".sync-mark")).toHaveCount(0);
  await expect(sheet).not.toContainText(/not synced/i);

  await sheet.locator(".type-btn", { hasText: "Task" }).click();
  await expect(sheet.getByTestId("sync-line")).toContainText("Not synced");
  await expect(sheet.locator(".sync-mark")).toHaveCount(1);

  await sheet.locator(".type-btn", { hasText: "Note" }).click();
  await expect(sheet.getByTestId("sync-line")).toHaveCount(0);
  await expect(sheet.locator(".sync-mark")).toHaveCount(0);
});

test("tapping Add entry opens no dialog: an edit sheet with a focused task line and the bar at its foot, at the screen bottom", async ({ page }) => {
  await page.goto(app.baseUrl);
  await expect(page.locator(".inline-bar")).toBeHidden();
  await page.locator("[data-action=add-entry]").click();

  await expect(page.getByRole("dialog")).toHaveCount(0);
  const sheet = page.getByRole("group", { name: "Entry editor" });
  await expect(sheet).toBeVisible();
  const line = sheet.locator(".paper-line[data-new=true]");
  await expect(line.locator(".paper-sym use")).toHaveAttribute("href", "#g-task");
  await expect(line.locator("input")).toBeFocused();
  const bar = sheet.locator(".inline-bar");
  await expect(bar).toBeVisible();
  const keys = bar.locator(".bar-key:visible");
  expect(await keys.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-key")))).toEqual(
    ["type", "tag", "date", "time", "remove", "up", "down", "indent", "outdent"],
  );
  expect((await keys.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label") ?? ""))).every(Boolean)).toBe(true);
  expect((await keys.evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim() ?? ""))).join("")).toBe("");
  const box = (await sheet.boundingBox())!;
  expect(Math.round(box.y + box.height)).toBe(844);
  const barBox = (await bar.boundingBox())!;
  expect(Math.round(barBox.y + barBox.height)).toBe(844);
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

test("each entry is an ink card: the symbol shares the title's row, the pills sit under the title start, a long title wraps", async ({ page }) => {
  const long = "Ein sehr langer Titel, der niemals auf eine Zeile passt und deshalb umbrechen muss ".repeat(2);
  await seed(page, [
    { date: day(0), type: "task", title: "Winzig", tag: "Haushalt" },
    { date: day(0), type: "event", title: long, tag: "Arbeit", time: "13:00" },
  ]);
  await page.goto(app.baseUrl);
  await expect(row(page, "Winzig")).toBeVisible();

  const card = page.locator(".entry-card", { has: row(page, "Winzig") });
  await expect(card.locator(":scope > svg.ink-stroke")).toHaveCount(1);
  const short = row(page, "Winzig");
  const sym = (await short.locator(".paper-sym").boundingBox())!;
  const title = (await short.locator(".paper-title").boundingBox())!;
  const pills = (await short.locator(".paper-meta").boundingBox())!;
  expect(Math.abs(sym.y - title.y)).toBeLessThan(4);
  expect(title.x).toBeGreaterThan(sym.x + sym.width - 1);
  expect(pills.y).toBeGreaterThanOrEqual(title.y + title.height);
  expect(Math.abs(pills.x - title.x)).toBeLessThan(1);
  await expect(short.locator(".pill")).toHaveText(["Haushalt"]);

  const wide = page.locator(".paper-row", { hasText: "Ein sehr langer" });
  const wideTitle = (await wide.locator(".paper-title").boundingBox())!;
  expect(wideTitle.height).toBeGreaterThan(30);
  const clipped = await wide.locator(".paper-title").evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(clipped).toBe(false);
  const rowBox = (await wide.boundingBox())!;
  const pillBox = (await wide.locator(".paper-meta").boundingBox())!;
  expect(pillBox.x + pillBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width);
  await expect(wide.locator(".pill")).toHaveText(["Arbeit", "13:00"]);
});

test("a server error keeps the new line in edit mode with its draft and an error", async ({ page }) => {
  await page.goto(app.baseUrl);
  let posts = 0;
  await page.route("**/api/entries", (route) => {
    if (route.request().method() !== "POST") return route.continue();
    posts += 1;
    return route.fulfill({ status: 400, json: { error: "title is too long (at most 200 characters)" } });
  });
  await page.locator("[data-action=add-entry]").click();
  await page.keyboard.type("Zu lang");
  await page.keyboard.press("Enter");

  const line = page.locator(".paper-line[data-new=true]");
  await expect(line.getByRole("alert")).toContainText("title is too long");
  await expect(line.locator("input")).toHaveValue("Zu lang");
  await expect(line.locator("input")).toBeFocused();
  await expect(page.locator(".inline-bar")).toBeVisible();
  expect(posts).toBe(1);
  await expect(page.locator('.paper-row[data-id]', { hasText: "Zu lang" })).toHaveCount(0);
});

test("a failing request with no server message shows the safe copy line", async ({ page }) => {
  await page.goto(app.baseUrl);
  await page.route("**/api/entries", (route) => (route.request().method() === "POST" ? route.abort() : route.continue()));
  await page.locator("[data-action=add-entry]").click();
  await page.keyboard.type("Offline Zeile");
  await page.keyboard.press("Enter");
  await expect(page.locator(".paper-line .paper-line-error")).toHaveText("Could not save this line. Try again.");
  await expect(page.locator(".paper-line input")).toHaveValue("Offline Zeile");
});

test("tap a row to type in its title; type, tag and day change through the bar and save", async ({ page }) => {
  await seed(page, [{ date: day(0), type: "task", title: "Kaffeebohnen bestellen", tag: "Haushalt" }]);
  await page.goto(app.baseUrl);
  await row(page, "Kaffeebohnen").click();

  await expect(page.getByRole("dialog")).toHaveCount(0);
  const input = page.locator(".paper-line input");
  await expect(input).toHaveValue("Kaffeebohnen bestellen");
  await expect(input).toBeFocused();
  await expect(page.locator(".sheet-chips .pill")).toHaveText(["Haushalt"]);

  await page.locator(".bar-key[data-key=type]").click();
  await page.locator('.inline-pop .pop-type[data-type="done"]').click();
  await page.locator(".bar-key[data-key=tag]").click();
  await page.locator('.inline-pop input[name="tag"]').fill("");
  await page.keyboard.press("Enter");
  await page.locator(".bar-key[data-key=date]").click();
  await page.locator('.inline-pop input[name="date"]').fill(day(1));
  await expect(page.locator(".inline-pop")).toHaveCount(0);

  await input.fill("Kaffeebohnen bestellt");
  await page.keyboard.press("Escape");

  const moved = page.locator(`.paper-day-group[data-date="${day(1)}"] .paper-row`, { hasText: "Kaffeebohnen bestellt" });
  await expect(moved).toHaveAttribute("data-type", "done");
  await expect(moved.locator(".pill")).toHaveText(["not synced"]);
  await expect(page.locator(`.paper-day-group[data-date="${day(0)}"] .paper-row`, { hasText: "Kaffeebohnen" })).toHaveCount(0);
  await expect(page.locator(".inline-bar")).toBeHidden();
});

test("the details sheet of a saved entry saves its fields, Escape and the scrim close it without saving", async ({ page }) => {
  await seed(page, [{ date: day(0), type: "note", title: "Bleibt wie es ist" }]);
  await page.goto(app.baseUrl);

  await openDetails(page, "Bleibt wie es ist");
  await page.getByRole("dialog").locator('input[name="title"]').fill("Nicht gespeichert");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(row(page, "Bleibt wie es ist")).toBeVisible();

  await openDetails(page, "Bleibt wie es ist");
  await page.locator(".ak-scrim").click({ position: { x: 195, y: 20 } });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(row(page, "Nicht gespeichert")).toHaveCount(0);

  await openDetails(page, "Bleibt wie es ist");
  const sheet = page.getByRole("dialog");
  await sheet.locator('input[name="title"]').fill("Jetzt gespeichert");
  await sheet.locator(".type-btn", { hasText: "Event" }).click();
  await sheet.locator("[data-action=save]").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(row(page, "Jetzt gespeichert")).toHaveAttribute("data-type", "event");
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
