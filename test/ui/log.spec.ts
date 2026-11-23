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

type Seed = { date: string; type: string; title: string; tags?: string[]; time?: string };

/** Creates fake entries through the API with the page's session. Never touches a real list. */
async function seed(page: Page, entries: Seed[]): Promise<void> {
  for (const entry of entries) {
    const response = await page.request.post(`${app.baseUrl}/api/entries`, { data: entry });
    expect(response.status()).toBe(201);
  }
}

const row = (page: Page, title: string) => page.locator(".paper-row", { hasText: title });

test("without a session the daily log sends you to sign in", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(app.baseUrl);
  await expect(page).toHaveURL(/\/signin$/);
  await context.close();
});

test("an empty log shows today with its mark and the add row, the tab bar with Scan (and no header camera), and no settings link, and no error", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(app.baseUrl);

  await expect(page.getByRole("heading", { name: "Daily Log", level: 1 })).toBeVisible();
  const today = page.locator(`.paper-day[data-date="${day(0)}"]`);
  await expect(today).toContainText(heading(day(0)));
  await expect(today.locator("[data-testid=today-mark]")).toHaveText("Today");
  await expect(page.locator("[data-testid=today-mark]")).toHaveCount(1);
  await expect(page.locator("[data-action=add-entry]")).toHaveText("+ Add entry");

  await expect(page.locator("[data-action=scan]")).toHaveCount(0);
  await expect(page.locator(".paper-head [data-nav=settings]")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);
  const tabs = page.getByRole("navigation", { name: "Main" });
  await expect(tabs.locator(".ak-tab")).toHaveText(["Daily log", "Notes", "Add", "Scan", "Account"]);
  await expect(tabs.getByRole("button", { name: "Add" })).toBeEnabled();
  await expect(tabs.getByRole("button", { name: "Scan" })).toBeEnabled();
  await expect(tabs.locator("[data-tab=log]")).toHaveAttribute("aria-current", "page");
  await expect(tabs.locator("[data-tab=add]")).not.toHaveAttribute("aria-current", "page");
  await expect(tabs.locator("[data-tab=scan]")).not.toHaveAttribute("aria-current", "page");
  expect(errors).toEqual([]);
});

test("entries are grouped under day headers with glyph, tag, time and sync dot", async ({ page }) => {
  await seed(page, [
    { date: day(-1), type: "done", title: "Gestern erledigt", tags: ["Arbeit"] },
    { date: day(-1), type: "migrated", title: "Gestern verschoben" },
    { date: day(0), type: "task", title: "Heute Aufgabe", tags: ["Haushalt"] },
    { date: day(0), type: "event", title: "Mittagessen im Café Linde", tags: ["Freizeit"], time: "13:00" },
    { date: day(0), type: "note", title: "Küchengarten, Frühjahr" },
    { date: day(1), type: "scheduled", title: "Vermieter anrufen" },
    { date: day(-30), type: "task", title: "Viel zu alt" },
    { date: day(30), type: "task", title: "Viel zu weit weg" },
  ]);
  await page.goto(app.baseUrl);
  await expect(row(page, "Heute Aufgabe")).toBeVisible();

  // One page per day: today opens, with its own heading and rows only. Days outside the window are no pages at all.
  await expect(page.locator(".paper-day")).toHaveText([new RegExp(`^${heading(day(0))}\\s*Today$`)]);
  await expect(page.getByTestId("page-folio")).toHaveText("2");
  await expect(row(page, "Gestern erledigt")).toHaveCount(0);
  await expect(row(page, "Vermieter")).toHaveCount(0);

  // Yesterday is one page back, tomorrow one forward, and the ends have no more.
  await page.getByTestId("page-prev").click();
  await expect(page.locator(".paper-day")).toHaveText([heading(day(-1))]);
  await expect(page.getByTestId("page-body")).toHaveAttribute("data-date", day(-1));
  await expect(page.locator(".paper-row")).toHaveCount(2);
  await expect(page.getByTestId("page-prev")).toBeDisabled();
  await page.getByTestId("page-next").click();
  await page.getByTestId("page-next").click();
  await expect(page.locator(".paper-day")).toHaveText([heading(day(1))]);
  await expect(page.getByTestId("page-next")).toBeDisabled();
  await page.getByTestId("page-prev").click();
  await expect(page.getByTestId("page-body")).toHaveAttribute("data-date", day(0));
  await expect(row(page, "Viel zu alt")).toHaveCount(0);
  await expect(row(page, "Viel zu weit weg")).toHaveCount(0);

  // Each type has its glyph from the sprite.
  const glyph = (title: string) => row(page, title).locator(".paper-sym use").getAttribute("href");
  expect(await glyph("Heute Aufgabe")).toBe("#g-task");
  expect(await glyph("Mittagessen")).toBe("#g-event");
  expect(await glyph("Küchengarten")).toBe("#g-note");
  await page.getByTestId("page-next").click();
  expect(await glyph("Vermieter")).toBe("#g-sched");
  await page.getByTestId("page-prev").click();
  await page.getByTestId("page-prev").click();
  expect(await glyph("Gestern erledigt")).toBe("#g-done");
  expect(await glyph("Gestern verschoben")).toBe("#g-moved");
  await expect(row(page, "Gestern erledigt")).toHaveAttribute("data-type", "done");
  await expect(row(page, "Gestern erledigt").locator(".paper-title")).toHaveCSS("text-decoration-line", "line-through");
  await expect(row(page, "Gestern verschoben")).toHaveCSS("opacity", "0.55");
  await page.getByTestId("page-next").click();

  // Pills under the title: the tag, then the time, or "not synced" when a local task has no tag. The dot says local.
  // A note is never synced, so it shows no label and no dot.
  await expect(row(page, "Heute Aufgabe").locator(".pill")).toHaveText(["Haushalt"]);
  await expect(row(page, "Mittagessen").locator(".pill")).toHaveText(["Freizeit", "13:00"]);
  await expect(row(page, "Küchengarten")).toHaveAttribute("data-sync", "local");
  // The words after its title hold only the "not on paper" mark: no pill and no sync dot.
  await expect(row(page, "Küchengarten").locator(".paper-meta > *")).toHaveCount(1);
  await expect(row(page, "Küchengarten").locator(".paper-meta .paper-off")).toHaveCount(1);
  await expect(row(page, "Küchengarten").locator(".pill")).toHaveCount(0);
  await expect(row(page, "Küchengarten").locator(".sync-mark")).toHaveCount(0);
  await expect(row(page, "Küchengarten")).not.toContainText("not synced");
  await expect(row(page, "Heute Aufgabe").locator(".sync-mark")).toHaveAttribute("data-sync", "local");
});

test("a note shows no sync label and no dot, a task and an event next to it still do", async ({ page }) => {
  await seed(page, [
    { date: day(0), type: "note", title: "Notiz ohne Tag" },
    { date: day(0), type: "note", title: "Notiz mit Tag", tags: ["Garten"], time: "08:15" },
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
  await expect(line.locator(".type-marker use")).toHaveAttribute("href", "#g-task");
  await expect(line.locator(".paper-edit-input")).toBeFocused();
  const bar = sheet.locator(".inline-bar");
  await expect(bar).toBeVisible();
  const keys = bar.locator(".bar-key:visible");
  expect(await keys.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-key")))).toEqual(
    ["next", "tag", "date", "time", "remove", "up", "down", "indent", "outdent"],
  );
  const icons = bar.locator(".bar-key:visible:not([data-key=next])");
  expect((await icons.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label") ?? ""))).every(Boolean)).toBe(true);
  expect((await icons.evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim() ?? ""))).join("")).toBe("");
  const box = (await sheet.boundingBox())!;
  expect(Math.round(box.y + box.height)).toBe(844);
  const barBox = (await bar.boundingBox())!;
  expect(Math.round(barBox.y + barBox.height)).toBe(844);
});

test("the paper is the page colour, never white, and its dot grid is on the scrolling sheet", async ({ page }, testInfo) => {
  await page.goto(app.baseUrl);
  await expect(page.locator("[data-testid=today-mark]")).toBeVisible();
  const dark = testInfo.project.name === "phone-dark";
  const grid = (selector: string) => page.locator(selector).first().evaluate((el) => {
    const style = getComputedStyle(el);
    return { bg: style.backgroundColor, image: style.backgroundImage, size: style.backgroundSize, attachment: style.backgroundAttachment, overflow: style.overflowY };
  });
  const paper = await grid("#log.paper");
  expect(paper.bg).toBe(dark ? "rgb(22, 19, 15)" : "rgb(244, 239, 228)");
  expect(paper.image).toContain("radial-gradient");
  expect(paper.size).toContain("24px 24px");
  expect(paper.attachment).toBe("local");
  expect(paper.overflow).toBe("auto");
  // The body of rows paints nothing of its own: the sheet's one grid runs under it.
  expect((await grid("[data-testid=page-body]")).image).toBe("none");
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(dark ? "rgb(22, 19, 15)" : "rgb(244, 239, 228)");
});

test("each entry is a borderless row: the symbol shares the title's line, the tags follow the title on it, a long title wraps", async ({ page }) => {
  const long = "Ein sehr langer Titel, der niemals auf eine Zeile passt und deshalb umbrechen muss ".repeat(2);
  await seed(page, [
    { date: day(0), type: "task", title: "Winzig", tags: ["Haushalt"] },
    { date: day(0), type: "event", title: long, tags: ["Arbeit"], time: "13:00" },
  ]);
  await page.goto(app.baseUrl);
  await expect(row(page, "Winzig")).toBeVisible();

  const card = page.locator(".entry-card", { has: row(page, "Winzig") });
  await expect(card.locator(":scope > svg.ink-stroke")).toHaveCount(0);
  const short = row(page, "Winzig");
  const sym = (await short.locator(".paper-sym").boundingBox())!;
  const title = (await short.locator(".paper-title").boundingBox())!;
  const meta = (await short.locator(".paper-meta").boundingBox())!;
  expect(Math.abs(sym.y - title.y)).toBeLessThan(4);
  expect(title.x).toBeGreaterThan(sym.x + sym.width - 1);
  // The tag is on the title's own line, after the title, not under it.
  expect(meta.x).toBeGreaterThanOrEqual(title.x + title.width - 1);
  expect(meta.y).toBeLessThan(title.y + title.height);
  await expect(short.locator(".pill")).toHaveText(["Haushalt"]);
  expect((await short.boundingBox())!.height).toBe(48);

  const wide = page.locator(".paper-row", { hasText: "Ein sehr langer" });
  const wideTitle = (await wide.locator(".paper-title").boundingBox())!;
  expect(wideTitle.height).toBeGreaterThan(30);
  const clipped = await wide.locator(".paper-body").evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(clipped).toBe(false);
  const rowBox = (await wide.boundingBox())!;
  for (const pill of await wide.locator(".pill").all()) {
    const box = (await pill.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(rowBox.x + rowBox.width);
  }
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
  await expect(line.locator(".paper-edit-input")).toHaveValue("Zu lang");
  await expect(line.locator(".paper-edit-input")).toBeFocused();
  await expect(page.locator(".inline-bar")).toBeVisible();
  expect(posts).toBe(1);
  await expect(page.locator('.paper-row[data-id]', { hasText: "Zu lang" })).toHaveCount(0);
});

test("a request that never reaches the server queues the line instead of failing it", async ({ page }) => {
  await page.goto(app.baseUrl);
  await page.route("**/api/entries", (route) => (route.request().method() === "POST" ? route.abort() : route.continue()));
  await page.locator("[data-action=add-entry]").click();
  await page.keyboard.type("Offline Zeile");
  await page.keyboard.press("Enter");
  // A network miss is not an error to show: the entry waits on the phone, marked, and the line moves on.
  const queued = page.locator(".paper-row", { hasText: "Offline Zeile" });
  await expect(queued).toHaveAttribute("data-queued", "create");
  await expect(queued.getByTestId("waiting-to-send")).toHaveText("waiting to send");
  await expect(page.locator(".paper-line .paper-line-error")).toHaveCount(0);
});

test("tap a row to type in its title; type (marker), tag and day change and save", async ({ page }) => {
  await seed(page, [{ date: day(0), type: "task", title: "Kaffeebohnen bestellen", tags: ["Haushalt"] }]);
  await page.goto(app.baseUrl);
  await row(page, "Kaffeebohnen").click();

  await expect(page.getByRole("dialog")).toHaveCount(0);
  const input = page.locator(".paper-line .paper-edit-input");
  await expect(input).toHaveValue("Kaffeebohnen bestellen");
  await expect(input).toBeFocused();
  await expect(page.locator(".sheet-chips .pill")).toHaveText(["Haushalt"]);

  await page.getByTestId("type-marker").click();
  await page.locator('[data-testid=type-chooser] .type-option[data-type="done"]').click();
  await page.locator(".bar-key[data-key=tag]").click();
  await page.locator(".inline-pop .pop-clear").click();
  await page.keyboard.press("Escape");
  await page.locator(".bar-key[data-key=date]").click();
  await page.locator('.inline-pop input[name="date"]').fill(day(1));
  await expect(page.locator(".inline-pop")).toHaveCount(0);

  await input.fill("Kaffeebohnen bestellt");
  await page.keyboard.press("Escape");

  // The entry now belongs to tomorrow: it leaves today's page, and tomorrow is a page with it.
  await expect(page.locator(".inline-bar")).toBeHidden();
  await expect(row(page, "Kaffeebohnen")).toHaveCount(0);
  await page.getByTestId("page-next").click();
  const moved = page.locator(`.paper-day-group[data-date="${day(1)}"] .paper-row`, { hasText: "Kaffeebohnen bestellt" });
  await expect(moved).toHaveAttribute("data-type", "done");
  await expect(moved.locator(".pill")).toHaveText(["not synced"]);
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
