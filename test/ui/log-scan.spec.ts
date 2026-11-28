import { expect, test, type Page } from "@playwright/test";
import { line } from "../fake-ocr.ts";
import { useBujo } from "./harness.ts";
import { addTab, doneButton, openScan, scanTab, shootAndDone } from "./scan-helpers.ts";

const app = useBujo();

// A 1x1 PNG. The fake OCR service ignores the pixels and answers the lines the test sets.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const photo = { name: "page.png", mimeType: "image/png", buffer: PNG };
const KIT_PINK = ["#e3166b", "#ff4d8d", "#c40e52", "#c2185b"].flatMap((hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return [`rgb(${r}, ${g}, ${b})`];
});

test.beforeEach(async ({ page }) => {
  await app.signIn(page);
  app.ocr.failWith(0);
  app.ocr.delay(0);
});

/** A calendar day as YYYY-MM-DD in the local time zone, n days from today (the page uses the local day too). */
function day(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The OCR header line for a day, as it is written on the page: dd.mm.yyyy. */
const headerLine = (iso: string) => line("none", `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`, 0.9);

function heading(iso: string): string {
  const [year, month, dayOfMonth] = iso.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, dayOfMonth)).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
  return `${weekday} ${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
}

async function seed(page: Page, entries: Array<{ date: string; type: string; title: string }>): Promise<void> {
  for (const entry of entries) expect((await page.request.post(`${app.baseUrl}/api/entries`, { data: entry })).status()).toBe(201);
}

/** Taps the Scan tab, sends the photo through the camera chooser the tap opened. The review sheet is up after this. */
async function scanPage(page: Page, lines: ReturnType<typeof line>[]): Promise<void> {
  app.ocr.setLines(lines);
  await page.goto(app.baseUrl);
  const chooser = await openScan(page);
  await chooser.setFiles(photo);
  await expect(page.getByTestId("scan-review")).toBeVisible();
}

const review = (page: Page) => page.getByTestId("scan-review");
const rows = (page: Page) => review(page).locator(".scan-row");
const logRow = (page: Page, title: string) => page.locator(".paper-row", { hasText: title });
const bar = (page: Page) => page.getByRole("navigation", { name: "Main" });

test("the header of the log has no camera and no settings icon, and the bar has Scan right of the raised, centred Add, neither ever the current page", async ({ page }) => {
  await page.goto(app.baseUrl);
  await expect(bar(page).locator(".ak-tab")).toHaveText(["Daily log", "Notes", "Add", "Scan", "Account"]);
  await expect(page.locator("[data-action=scan]")).toHaveCount(0);
  await expect(page.locator(".paper-head [data-nav=settings]")).toHaveCount(0);
  await expect(page.locator(".paper-head").getByText("Scan a page")).toHaveCount(0);
  // Nothing is left to write down, so the header has no button at all.
  await expect(page.locator(".paper-head button")).toHaveCount(0);

  for (const path of ["/", "/notes", "/settings"]) {
    await page.goto(`${app.baseUrl}${path}`);
    for (const [tab, name] of [[addTab(page), "Add"], [scanTab(page), "Scan"]] as const) {
      await expect(tab).toBeVisible();
      await expect(tab).toHaveAccessibleName(name);
      await expect(tab).not.toHaveAttribute("aria-current", "page");
    }
  }

  // Add sits in the middle, raised above the other tabs, with Scan immediately to its right.
  await page.goto(app.baseUrl);
  const ids = ["log", "notes", "add", "scan", "account"];
  const boxes = await Promise.all(ids.map((id) => bar(page).locator(`[data-tab=${id}]`).boundingBox()));
  const [log, notes, add, scan, account] = boxes.map((box) => box!);
  expect(log.x).toBeLessThan(notes.x);
  expect(notes.x + notes.width).toBeLessThanOrEqual(add.x + 1);
  expect(add.x + add.width).toBeLessThanOrEqual(scan.x + 1);
  expect(scan.x - (add.x + add.width)).toBeLessThan(2);
  expect(scan.x + scan.width).toBeLessThanOrEqual(account.x + 1);
  expect(Math.abs(add.x + add.width / 2 - 390 / 2)).toBeLessThan(24);
  expect(scan.width).toBeGreaterThanOrEqual(44);
  expect(scan.height).toBeGreaterThanOrEqual(44);
  const circle = (await addTab(page).locator(".ak-tab-icon").boundingBox())!;
  expect(circle.y).toBeLessThan(log.y);
  // Scan is a plain tab, not a second raised button: its icon sits level with the other tabs.
  const camera = (await scanTab(page).locator(".ak-tab-icon").boundingBox())!;
  const rapid = (await bar(page).locator("[data-tab=log] .ak-tab-icon").boundingBox())!;
  expect(Math.abs(camera.y - rapid.y)).toBeLessThan(1);
});

test("the Not on paper button stays in the header, and the header still has no camera", async ({ page }) => {
  await seed(page, [{ date: day(0), type: "task", title: "Noch nicht auf Papier" }]);
  await page.goto(app.baseUrl);
  const paper = page.getByTestId("not-on-paper-open");
  await expect(paper).toBeVisible();
  await expect(page.locator(".paper-head [data-testid=not-on-paper-open]")).toHaveCount(1);
  await expect(page.locator("[data-action=scan]")).toHaveCount(0);
  await expect(page.locator(".paper-head").getByText("Scan a page")).toHaveCount(0);
  const [title, todo] = await Promise.all([page.locator(".paper-head h1").boundingBox(), paper.boundingBox()]);
  expect(todo!.x + todo!.width).toBeLessThanOrEqual(390);
  const mid = (box: { y: number; height: number }) => box.y + box.height / 2;
  expect(Math.abs(mid(todo!) - mid(title!))).toBeLessThan(12);

  await paper.click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("tapping the Scan tab opens the file chooser in the same tap, from Notes and Account too, and the camera screen, with the gallery still there", async ({ page }) => {
  for (const path of ["/notes", "/settings"]) {
    await page.goto(`${app.baseUrl}${path}`);
    const [from] = await Promise.all([page.waitForEvent("filechooser"), scanTab(page).click()]);
    expect(await from.element().getAttribute("id")).toBe("scan-file");
    await expect(page.getByTestId("scan-screen")).toBeVisible();
    await expect(scanTab(page)).not.toHaveAttribute("aria-current", "page");
  }
  await page.goto(app.baseUrl);
  await page.goto(app.baseUrl);
  const chooser = await openScan(page);
  expect(chooser.isMultiple()).toBe(false);
  expect(await chooser.element().getAttribute("id")).toBe("scan-file");

  const screen = page.getByTestId("scan-screen");
  await expect(screen.getByRole("heading", { name: "Align the page" })).toBeVisible();
  await expect(screen.locator("#scan-file")).toHaveAttribute("capture", "environment");
  await expect(screen.locator("#scan-gallery")).not.toHaveAttribute("capture");
  await expect(addTab(page)).not.toHaveAttribute("aria-current", "page");
  await expect(page).toHaveURL(`${app.baseUrl}/`);

  // The person cancels the camera: the screen stays and the gallery sends the photo.
  app.ocr.setLines([headerLine(day(0)), line("•", "Nach dem Abbrechen", 0.9)]);
  await screen.locator("#scan-gallery").setInputFiles(photo);
  await expect(page.getByTestId("scan-review")).toBeVisible();
});

test("the /?scan=1 link still opens the scan screen on the log, drops the query, and a reload does not reopen it", async ({ page }) => {
  await page.goto(`${app.baseUrl}/?scan=1`);
  await expect(page.getByTestId("scan-screen")).toHaveCount(1);
  await expect(page.getByTestId("scan-screen")).toBeVisible();
  await expect(page).toHaveURL(`${app.baseUrl}/`);
  await expect(page.getByRole("heading", { name: "Daily Log", level: 1 })).toBeVisible();
  await expect(addTab(page)).not.toHaveAttribute("aria-current", "page");

  await page.reload();
  await expect(page.getByRole("heading", { name: "Daily Log", level: 1 })).toBeVisible();
  await expect(page.getByTestId("scan-screen")).toHaveCount(0);
});

test("a programmatic router.scan() from Notes still goes to the log and opens the scan screen", async ({ page }) => {
  await page.goto(`${app.baseUrl}/notes`);
  await expect(page.locator("#notes")).toBeVisible();
  await page.evaluate(() => (window as unknown as { BujoNav: { router: { scan(): void } } }).BujoNav.router.scan());
  await expect(page.getByTestId("scan-screen")).toBeVisible();
  await expect(page).toHaveURL(`${app.baseUrl}/`);
  await expect(page.getByRole("heading", { name: "Daily Log", level: 1 })).toBeVisible();
});

test("while a page is read the progress state shows the photo, the step and a ticking time, then the review follows", async ({ page }) => {
  app.ocr.delay(3000);
  app.ocr.setLines([headerLine(day(0)), line("•", "Langsam gelesen", 0.9)]);
  await page.goto(app.baseUrl);
  const chooser = await openScan(page);
  await chooser.setFiles(photo);

  const progress = page.getByTestId("scan-progress");
  await expect(progress).toBeVisible();
  await expect(progress.getByTestId("scan-step")).toHaveText("Reading your page\u2026");
  await expect(progress.locator("img.scan-progress-img")).toHaveAttribute("src", /^data:image\/png/);
  await expect(progress.locator(".scan-progress-shimmer")).toBeAttached();
  await expect(progress.getByTestId("scan-elapsed")).toHaveText(/^0:\d\d$/);
  await expect(progress.getByTestId("scan-elapsed")).toHaveText(/^0:0[1-9]$/);
  await expect(page.getByTestId("scan-screen")).toHaveAttribute("aria-busy", "true");
  await expect(page.getByRole("button", { name: "Take a photo" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Close" })).toBeEnabled();

  await expect(page.getByTestId("scan-review")).toBeVisible();
  await expect(page.getByTestId("scan-screen")).toHaveCount(0);
  await expect(page.getByTestId("scan-progress")).toHaveCount(0);
  await expect(rows(page).nth(0).locator('[data-field="title"]')).toHaveValue("Langsam gelesen");
});

test("the shimmer stands still with reduced motion, and the time still ticks", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  app.ocr.delay(2500);
  await page.goto(app.baseUrl);
  const chooser = await openScan(page);
  await chooser.setFiles(photo);
  const shimmer = page.getByTestId("scan-progress").locator(".scan-progress-shimmer");
  await expect(shimmer).toBeAttached();
  expect(await shimmer.evaluate((node) => getComputedStyle(node).animationName)).toBe("none");
  await expect(page.getByTestId("scan-elapsed")).toHaveText(/^0:0[1-9]$/);
});

test("closing during the read ignores the late answer: no review opens", async ({ page }) => {
  app.ocr.delay(1500);
  await page.goto(app.baseUrl);
  const chooser = await openScan(page);
  await chooser.setFiles(photo);
  await expect(page.getByTestId("scan-progress")).toBeVisible();

  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId("scan-screen")).toHaveCount(0);
  await expect.poll(() => app.ocr.requests.filter((request) => request.path === "/ocr").length).toBeGreaterThan(0);
  await page.waitForTimeout(2200);
  await expect(page.getByTestId("scan-review")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Daily Log", level: 1 })).toBeVisible();
});

test("a failed read leaves the progress state and shows the trouble on the camera screen", async ({ page }) => {
  app.ocr.failWith(503);
  await page.goto(app.baseUrl);
  const chooser = await openScan(page);
  await chooser.setFiles(photo);
  const screen = page.getByTestId("scan-screen");
  await expect(screen.getByRole("alert")).toHaveText("Couldn\u2019t read the page right now. Try again.");
  await expect(screen.getByRole("alert")).not.toContainText(/OCR|503|category|not configured/i);
  await expect(page.getByTestId("scan-progress")).toHaveCount(0);
  await expect(screen.locator(".scan-frame")).toBeVisible();
  // Nothing is lost: the photo stays in the tray, so Done reads it again once the service is back.
  await expect(screen.getByRole("button", { name: "Take a photo" })).toBeEnabled();
  await expect(screen.getByTestId("scan-thumb")).toHaveCount(1);
  app.ocr.failWith(0);
  await doneButton(page).click();
  await expect(page.getByTestId("scan-review")).toBeVisible();
});

test("the camera screen has the title, frame, shutter, and close, and no mode toggle", async ({ page }) => {
  await page.goto(app.baseUrl);
  await openScan(page);

  const screen = page.getByTestId("scan-screen");
  await expect(screen.getByRole("heading", { name: "Align the page" })).toBeVisible();
  await expect(screen.locator(".scan-frame")).toBeVisible();
  await expect(screen.locator("#scan-file")).toHaveAttribute("capture", "environment");
  await expect(screen.locator("#scan-file")).toHaveAttribute("accept", "image/*");
  await expect(screen.locator("#scan-gallery")).not.toHaveAttribute("capture");
  await expect(screen.locator("#scan-gallery")).toHaveAttribute("accept", "image/*");
  await expect(screen.getByRole("button", { name: "Log page" })).toHaveCount(0);
  await expect(screen.getByRole("button", { name: "Free note" })).toHaveCount(0);
  await expect(screen.getByRole("button", { name: "Take a photo" })).toBeEnabled();
  await expect(screen.getByRole("button", { name: "Choose from gallery" })).toBeEnabled();
  const [gallery, shutter] = [await screen.locator(".scan-gallery").boundingBox(), await screen.locator(".scan-shutter").boundingBox()];
  expect(gallery!.x + gallery!.width).toBeLessThanOrEqual(shutter!.x);

  await screen.getByRole("button", { name: "Close" }).click();
  await expect(screen).toHaveCount(0);
});

test("a photo picked through the gallery input reaches the review sheet", async ({ page }) => {
  app.ocr.setLines([headerLine(day(0)), line("•", "Aus der Galerie", 0.9)]);
  await page.goto(app.baseUrl);
  await openScan(page);
  await page.locator("#scan-gallery").setInputFiles(photo);
  await expect(page.getByTestId("scan-review")).toBeVisible();
  await expect(rows(page).nth(0).locator('[data-field="title"]')).toHaveValue("Aus der Galerie");
});

test("nothing is written until Apply: a photo, the review, one line dropped, one edited, then the log shows them", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await scanPage(page, [
    headerLine(day(0)),
    line("•", "Tasche für Stuttgart packen", 0.94),
    line("○", "Lunch with Mira at Cafe Linde", 0.71),
    line("–", "library card expires in Januar", 0.63),
  ]);

  // The camera is gone, the review shows the day, where it came from and the counts.
  await expect(page.getByTestId("scan-screen")).toHaveCount(0);
  await expect(review(page).getByRole("heading", { name: "Review scan" })).toBeVisible();
  await expect(page.getByTestId("scan-date")).toHaveText(heading(day(0)));
  await expect(page.getByTestId("scan-date-source")).toHaveText("Read from the page");
  await expect(page.getByTestId("scan-sub")).toHaveText(`${heading(day(0))} \u00b7 3 new entries`);
  await expect(rows(page)).toHaveCount(3);
  await expect(rows(page).nth(0).locator('[data-field="title"]')).toHaveValue("Tasche für Stuttgart packen");
  await expect(rows(page).nth(0).locator(".scan-note")).toBeHidden();
  await expect(rows(page).nth(1).locator(".scan-note")).toHaveText("hard to read, check the text");
  await expect(rows(page).nth(1)).toHaveAttribute("data-low", "true");
  await expect(rows(page).nth(0)).toHaveAttribute("data-low", "false");
  await expect(review(page).locator("[data-action=apply]")).toHaveText("Apply 3 entries");

  // Nothing is in the log yet.
  const before = await page.request.get(`${app.baseUrl}/api/entries?from=${day(0)}&to=${day(0)}`);
  expect(JSON.stringify(await before.json())).not.toContain("Stuttgart");

  // Each row's check says what it does in words, and it sits on a hand-drawn box that is visible whether the line is kept or skipped.
  await expect(rows(page).locator('[data-field="include"] .scan-keep-label')).toHaveText(["Keep", "Keep", "Keep"]);
  const keepBox = rows(page).nth(1).locator(".scan-keep-box .ink-tick-box").first();
  const boxEdge = () => keepBox.evaluate((node) => getComputedStyle(node).strokeWidth);
  expect(parseFloat(await boxEdge())).toBeGreaterThan(0);
  await expect(rows(page).nth(1).locator('[data-field="include"]')).toHaveAccessibleName("Keep this line");

  // Drop the second line, edit the third: its type and title (the review has no tag field).
  await rows(page).nth(1).locator('[data-field="include"]').click();
  await expect(rows(page).nth(1)).toHaveAttribute("data-include", "false");
  await expect(rows(page).nth(1).locator('[data-field="include"]')).toHaveAttribute("aria-checked", "false");
  expect(parseFloat(await boxEdge())).toBeGreaterThan(0);
  await expect(rows(page).nth(1).locator(".scan-keep-label")).toBeVisible();
  await expect(rows(page).nth(1).locator('[data-field="include"]')).toHaveAccessibleName("Keep this line");
  await expect(review(page).locator("[data-action=apply]")).toHaveText("Apply 2 entries");
  await rows(page).nth(2).locator('[data-field="type"]').selectOption("task");
  await rows(page).nth(2).locator('[data-field="title"]').fill("Library card expires in January");
  await review(page).locator("[data-action=apply]").click();

  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(logRow(page, "Tasche für Stuttgart packen")).toHaveAttribute("data-type", "task");
  const edited = logRow(page, "Library card expires in January");
  await expect(edited).toHaveAttribute("data-type", "task");
  await expect(logRow(page, "Lunch with Mira")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("an x line over an open task is an update with before and after, and a repeated line shows as matched, not as a new entry", async ({ page }) => {
  await seed(page, [
    { date: day(0), type: "task", title: "Water the office plants" },
    { date: day(0), type: "note", title: "Idee Wochenende" },
  ]);
  await scanPage(page, [headerLine(day(0)), line("x", "Water the office plants", 0.91), line("–", "Idee Wochenende", 0.9), line("•", "Kuchen backen", 0.9)]);

  await expect(rows(page).nth(0)).toHaveAttribute("data-status", "edited");
  await expect(rows(page).nth(0).locator('[data-role="note"]')).toHaveText("matches, will be marked as done");
  await expect(rows(page).nth(0)).toHaveAttribute("data-include", "true");
  await expect(rows(page).nth(0).locator(".scan-glyph svg use")).toHaveAttribute("href", "#g-done");
  await expect(rows(page)).toHaveCount(3);

  // The repeated note is shown, matched, with nothing to write and nothing ticked. No fold hides it.
  await expect(page.getByTestId("scan-unchanged")).toHaveCount(0);
  await expect(rows(page).nth(1)).toBeVisible();
  await expect(rows(page).nth(1)).toHaveAttribute("data-status", "unchanged");
  await expect(rows(page).nth(1)).toHaveAttribute("data-match", "matched");
  await expect(rows(page).nth(1)).toHaveAttribute("data-include", "false");
  await expect(rows(page).nth(1).locator('[data-role="note"]')).toHaveText("already matches");
  await expect(rows(page).nth(2)).toHaveAttribute("data-status", "new");
  await expect(rows(page).nth(2).locator('[data-role="note"]')).toBeHidden();
  await expect(rows(page).nth(2).locator('[data-field="unmatch"]')).toBeHidden();
  await expect(review(page).locator("[data-action=apply]")).toHaveText("Apply 1 new, 1 update");
  await expect(page.getByTestId("scan-sub")).toHaveText(`${heading(day(0))} \u00b7 1 new entry, 1 update, 1 marked on paper`);

  await review(page).locator("[data-action=apply]").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(logRow(page, "Water the office plants")).toHaveCount(1);
  await expect(logRow(page, "Water the office plants")).toHaveAttribute("data-type", "done");
  await expect(logRow(page, "Idee Wochenende")).toHaveCount(1);
  await expect(logRow(page, "Kuchen backen")).toHaveAttribute("data-type", "task");
});

test("a line with OCR noise is shown as matching the existing item, and apply adds no duplicate", async ({ page }) => {
  await seed(page, [{ date: day(0), type: "task", title: "Fensterputzer anrufen" }, { date: day(0), type: "task", title: "Roggenbrot kaufen" }]);
  await scanPage(page, [headerLine(day(0)), line("•", "Fensterputzer anrufcn", 0.78), line("x", "Roggenbrot kaufn", 0.9)]);

  await expect(rows(page).nth(0)).toBeVisible();
  await expect(rows(page).nth(0).locator('[data-role="note"]')).toHaveText("was Fensterputzer anrufen, hard to read, check the text");
  await expect(rows(page).nth(0)).toHaveAttribute("data-status", "unchanged");
  await expect(rows(page).nth(1).locator('[data-role="note"]')).toHaveText("was \u2022 Roggenbrot kaufen \u2192 done");
  await expect(review(page).locator("[data-action=apply]")).toHaveText("Apply 1 update");

  await review(page).locator("[data-action=apply]").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(logRow(page, "Fensterputzer anrufen")).toHaveCount(1);
  await expect(logRow(page, "Fensterputzer anrufen")).toHaveAttribute("data-type", "task");
  await expect(logRow(page, "Fensterputzer anrufcn")).toHaveCount(0);
  await expect(logRow(page, "Roggenbrot kaufen")).toHaveCount(1);
  await expect(logRow(page, "Roggenbrot kaufen")).toHaveAttribute("data-type", "done");
  await expect(logRow(page, "Roggenbrot kaufn")).toHaveCount(0);
});

test("Not the same turns a matched line into a new entry, and Match again puts it back", async ({ page }) => {
  await seed(page, [{ date: day(0), type: "task", title: "Steuererklaerung abgeben" }]);
  await scanPage(page, [headerLine(day(0)), line("x", "Steuererklaerung abgcben", 0.9)]);
  const first = rows(page).nth(0);
  const unmatch = first.locator('[data-field="unmatch"]');

  await expect(unmatch).toHaveAccessibleName("Not the same");
  await expect(unmatch).toHaveAttribute("data-state", "matched");
  await expect(review(page).locator("[data-action=apply]")).toHaveText("Apply 1 update");
  const box = await unmatch.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);

  await unmatch.click();
  await expect(first).toHaveAttribute("data-status", "new");
  await expect(first).toHaveAttribute("data-match", "unmatched");
  await expect(first).toHaveAttribute("data-include", "true");
  await expect(first.locator('[data-role="note"]')).toHaveText("new entry, not Steuererklaerung abgeben");
  await expect(unmatch).toHaveAccessibleName("Match again");
  await expect(unmatch).toHaveAttribute("data-state", "unmatched");
  await expect(review(page).locator("[data-action=apply]")).toHaveText("Apply 1 entry");

  // The server agrees: a recheck keeps it new, and a reload of the check does not bring the match back.
  await first.locator('[data-field="title"]').press("Tab");
  await expect(first).toHaveAttribute("data-status", "new");

  await unmatch.click();
  await expect(first).toHaveAttribute("data-status", "edited");
  await expect(first.locator('[data-role="note"]')).toHaveText("was \u2022 Steuererklaerung abgeben \u2192 done");
  await expect(review(page).locator("[data-action=apply]")).toHaveText("Apply 1 update");

  await unmatch.click();
  await review(page).locator("[data-action=apply]").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(logRow(page, "Steuererklaerung abgeben")).toHaveCount(1);
  await expect(logRow(page, "Steuererklaerung abgeben")).toHaveAttribute("data-type", "task");
  await expect(logRow(page, "Steuererklaerung abgcben")).toHaveAttribute("data-type", "done");
});

test("a rescan shows updates, new lines and matched lines, and applies without touching an entry missing from the page", async ({ page }) => {
  await seed(page, [
    { date: day(0), type: "task", title: "Semmeln kaufen" },
    { date: day(0), type: "task", title: "Kieferorthopaede anrufen" },
    { date: day(0), type: "note", title: "Idee Urlaub" },
    { date: day(0), type: "event", title: "Nicht mehr auf dem Blatt" },
  ]);
  await scanPage(page, [
    headerLine(day(0)),
    line("x", "Semmeln kaufen", 0.92),
    line("•", "Kieferorthopaede anrufen #health 14h30", 0.9),
    line("–", "Idee Urlaub", 0.9),
    line("•", "Post abholen", 0.9),
  ]);

  await expect(review(page).locator('.scan-row[data-status="edited"]')).toHaveCount(2);
  await expect(review(page).locator('.scan-row[data-status="new"]')).toHaveCount(1);
  await expect(review(page).locator('.scan-row[data-status="unchanged"]')).toBeVisible();
  await expect(review(page).locator("[data-action=apply]")).toHaveText("Apply 1 new, 2 updates");
  const tagged = review(page).locator('.scan-row[data-id="l3"]');
  await expect(tagged.locator('[data-role="note"]')).toContainText("will update the entry");
  await expect(tagged.locator('[data-role="note"]')).toContainText("time was none");
  await expect(tagged.locator('[data-role="note"]')).not.toContainText("Kieferorthopaede");
  await expect(tagged.locator('[data-field="tag"]')).toHaveCount(0);

  // Skipping the new line leaves only the two updates to write.
  await review(page).locator('.scan-row[data-id="l5"] [data-field="include"]').click();
  await expect(review(page).locator("[data-action=apply]")).toHaveText("Apply 2 updates");

  await review(page).locator("[data-action=apply]").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(logRow(page, "Semmeln kaufen")).toHaveAttribute("data-type", "done");
  const kiefer = logRow(page, "Kieferorthopaede anrufen");
  await expect(kiefer).toHaveCount(1);
  await expect(kiefer.locator(".pill")).toContainText(["health", "14:30"]);
  await expect(logRow(page, "Idee Urlaub")).toHaveAttribute("data-type", "note");
  await expect(logRow(page, "Post abholen")).toHaveCount(0);
  await expect(logRow(page, "Nicht mehr auf dem Blatt")).toHaveCount(1);
});

test("a page that only repeats an entry not yet on paper shows its matched line and offers to mark it on paper", async ({ page }) => {
  await seed(page, [{ date: day(0), type: "task", title: "Nur wiederholt" }]);
  await scanPage(page, [headerLine(day(0)), line("•", "Nur wiederholt", 0.9)]);
  await expect(rows(page).nth(0)).toBeVisible();
  await expect(rows(page).nth(0).locator('[data-role="note"]')).toHaveText("already matches");
  await expect(review(page).locator("[data-action=apply]")).toBeEnabled();
  await expect(review(page).locator("[data-action=apply]")).toHaveText("Mark 1 on paper");
  await review(page).locator("[data-action=apply]").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await scanPage(page, [headerLine(day(0)), line("•", "Nur wiederholt", 0.9)]);
  await expect(review(page).locator("[data-action=apply]")).toBeDisabled();
  await expect(review(page).locator("[data-action=apply]")).toHaveText("Nothing to apply");
});

test("a new line has no match words and no Not the same button", async ({ page }) => {
  await scanPage(page, [headerLine(day(0)), line("•", "Ganz neu", 0.9)]);
  await expect(rows(page).nth(0).locator('[data-role="note"]')).toBeHidden();
  await expect(rows(page).nth(0).locator('[data-field="unmatch"]')).toBeHidden();
});

test("a rescan after an app edit does not overwrite the edit", async ({ page }) => {
  await scanPage(page, [headerLine(day(0)), line("•", "Gartentor streichen", 0.9)]);
  await review(page).locator("[data-action=apply]").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const stored = await page.request.get(`${app.baseUrl}/api/entries?from=${day(0)}&to=${day(0)}`);
  const made = (await stored.json()).entries.find((entry: { title: string }) => entry.title === "Gartentor streichen");
  await page.waitForTimeout(10);
  expect((await page.request.patch(`${app.baseUrl}/api/entries/${made.id}`, { data: { type: "migrated", tags: ["Haushalt"] } })).status()).toBe(200);

  await scanPage(page, [headerLine(day(0)), line("•", "Gartentor streichen", 0.9), line("•", "Eier holen", 0.9)]);
  await expect(review(page).locator('.scan-row[data-status="unchanged"]')).toBeVisible();
  await expect(review(page).locator('.scan-row[data-status="new"]')).toHaveCount(1);
  await review(page).locator("[data-action=apply]").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(logRow(page, "Gartentor streichen")).toHaveAttribute("data-type", "migrated");
  await expect(logRow(page, "Eier holen")).toHaveCount(1);
});

test("a page with no date uses today, and picking another day rechecks the lines against that day", async ({ page }) => {
  await seed(page, [{ date: day(1), type: "task", title: "Butter holen" }]);
  await scanPage(page, [line("•", "Butter holen", 0.9)]);

  await expect(page.getByTestId("scan-date")).toHaveText(heading(day(0)));
  await expect(page.getByTestId("scan-date-source")).toHaveText("Today, no date found");
  await expect(rows(page).nth(0)).toHaveAttribute("data-status", "new");

  await review(page).locator('[data-field="date"]').fill(day(1));
  await expect(page.getByTestId("scan-date")).toHaveText(heading(day(1)));
  await expect(page.getByTestId("scan-date-source")).toHaveText("Picked by you");
  await expect(rows(page).nth(0)).toHaveAttribute("data-status", "unchanged");
  await expect(rows(page).nth(0)).toHaveAttribute("data-include", "false");
  await expect(rows(page).nth(0).locator('[data-role="note"]')).toHaveText("already matches");
  await expect(review(page).locator("[data-action=apply]")).toHaveText("Mark 1 on paper");

  // Edit the line so it differs from the entry: it becomes an update to that day's entry, not a second row.
  await rows(page).nth(0).locator('[data-field="title"]').fill("Butter und Brot holen");
  await rows(page).nth(0).locator('[data-field="title"]').press("Tab");
  await expect(rows(page).nth(0)).toHaveAttribute("data-status", "edited");
  await expect(rows(page).nth(0)).toHaveAttribute("data-include", "true");
  await review(page).locator("[data-action=apply]").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(`.paper-day-group[data-date="${day(1)}"]`).locator(".paper-row", { hasText: "Butter und Brot" })).toHaveCount(1);
  await expect(page.locator(`.paper-day-group[data-date="${day(1)}"]`).locator(".paper-row", { hasText: "Butter holen" })).toHaveCount(0);
});

test("a day outside the usual window is shown after Apply", async ({ page }) => {
  await scanPage(page, [headerLine(day(-20)), line("•", "Alte Seite", 0.9)]);
  await review(page).locator("[data-action=apply]").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(`.paper-day-group[data-date="${day(-20)}"]`).locator(".paper-row", { hasText: "Alte Seite" })).toHaveCount(1);
});

test("a kept line needs a title, and dismissing the review writes nothing", async ({ page }) => {
  await scanPage(page, [headerLine(day(0)), line("•", "Leere Zeile", 0.9)]);
  await rows(page).nth(0).locator('[data-field="title"]').fill("");
  await expect(review(page).locator("[data-action=apply]")).toBeDisabled();
  await expect(review(page).getByRole("alert")).toContainText("Give every kept line a title.");

  await rows(page).nth(0).locator('[data-field="title"]').fill("Nur im Review");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".paper-row", { hasText: "Nur im Review" })).toHaveCount(0);
  const stored = await page.request.get(`${app.baseUrl}/api/entries?from=${day(0)}&to=${day(0)}`);
  expect(JSON.stringify(await stored.json())).not.toContain("Nur im Review");
});

test("trouble stays on the camera screen: a wrong file, a failing OCR and an empty page", async ({ page }) => {
  await page.goto(app.baseUrl);
  await openScan(page);
  const screen = page.getByTestId("scan-screen");

  await shootAndDone(page, { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(screen.getByRole("alert")).toContainText("not a JPEG, PNG, WebP or HEIC photo");
  // The photo that failed stays in the tray: Done tries it again, or the x takes it out.
  await expect(screen.getByTestId("scan-thumb")).toHaveCount(1);
  await screen.locator("[data-action=thumb-remove]").click();

  app.ocr.failWith(500);
  await shootAndDone(page, photo);
  await expect(screen.getByRole("alert")).toHaveText("Couldn\u2019t read the page right now. Try again.");
  await expect(screen.getByRole("button", { name: "Take a photo" })).toBeEnabled();
  await expect(screen.getByRole("button", { name: "Choose from gallery" })).toBeEnabled();

  app.ocr.failWith(0);
  app.ocr.setLines([]);
  await doneButton(page).click();
  await expect(screen.getByRole("alert")).toContainText("No lines were read from this page.");
  await expect(screen).toBeVisible();

  app.ocr.setLines([line("•", "Doch noch", 0.9)]);
  await doneButton(page).click();
  await expect(page.getByTestId("scan-review")).toBeVisible();
});

test("a HEIC photo with no type is accepted, and the photo is never put in the page", async ({ page }) => {
  app.ocr.setLines([line("•", "Aus dem Foto", 0.9)]);
  await page.goto(app.baseUrl);
  const chooser = await openScan(page);
  await chooser.setFiles({ name: "IMG_0001.HEIC", mimeType: "", buffer: PNG });
  await expect(page.getByTestId("scan-review")).toBeVisible();
  expect(await page.locator('[data-testid="scan-review"] :is(img, canvas, video)').count()).toBe(0);
  // The only inline url() allowed is the pen outline of an ink button (a data: mask, data-ink), never a photo.
  expect(await page.locator('[data-testid="scan-review"] [src], [data-testid="scan-review"] [style*="url("]:not([data-ink])').count()).toBe(0);
  expect(await page.locator('[data-testid="scan-review"] [data-ink][style*="url("]:not([style*="data:image/svg+xml"])').count()).toBe(0);
});

test("the scan screen and the review use paper colours, never the kit pink", async ({ page }) => {
  await scanPage(page, [headerLine(day(0)), line("•", "Tasche packen", 0.7)]);
  const paperInk = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--paper-ink").trim());
  const probe = async (selector: string) =>
    page.locator(selector).evaluate((root) => {
      const props = ["color", "backgroundColor", "borderTopColor", "borderBottomColor", "outlineColor", "boxShadow", "accentColor"] as const;
      const nodes = [root, ...Array.from(root.querySelectorAll("*"))];
      return {
        accent: getComputedStyle(root).getPropertyValue("--ak-accent").trim(),
        used: nodes.flatMap((node) => props.map((prop) => getComputedStyle(node)[prop])).join(" | "),
      };
    });

  const sheet = await probe('[data-testid="scan-review"]');
  expect(sheet.accent.toLowerCase()).toBe(paperInk.toLowerCase());
  for (const pink of KIT_PINK) expect(sheet.used).not.toContain(pink);

  await page.keyboard.press("Escape");
  await openScan(page);
  await page.locator('[data-testid="scan-screen"] .scan-shutter').focus();
  const screen = await probe('[data-testid="scan-screen"]');
  expect(screen.accent.toLowerCase()).toBe(paperInk.toLowerCase());
  for (const pink of KIT_PINK) expect(screen.used).not.toContain(pink);
});

test("a struck-through line is left out of the review, and applying leaves a matching open task alone", async ({ page }) => {
  await seed(page, [{ date: day(0), type: "task", title: "Fenster putzen" }]);
  await scanPage(page, [headerLine(day(0)), line("~", "Fenster putzen", 0.9, 1), line("~", "Alte Idee", 0.8, 2), line("•", "Kerzen holen", 0.7, 3)]);

  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).nth(0).locator('[data-field="title"]')).toHaveValue("Kerzen holen");

  await review(page).locator("[data-action=apply]").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(logRow(page, "Fenster putzen")).toHaveAttribute("data-type", "task");
  await expect(logRow(page, "Alte Idee")).toHaveCount(0);
  await expect(logRow(page, "Kerzen holen")).toHaveAttribute("data-type", "task");
});
