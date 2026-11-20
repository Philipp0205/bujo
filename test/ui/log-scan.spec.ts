import { expect, test, type Page } from "@playwright/test";
import { line } from "../fake-ocr.ts";
import { useBujo } from "./harness.ts";

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

/** Opens the camera screen and sends the photo. The review sheet is up after this. */
async function scanPage(page: Page, lines: ReturnType<typeof line>[]): Promise<void> {
  app.ocr.setLines(lines);
  await page.goto(app.baseUrl);
  await page.getByRole("button", { name: "Scan a page" }).click();
  await page.locator("#scan-file").setInputFiles(photo);
  await expect(page.getByTestId("scan-review")).toBeVisible();
}

const review = (page: Page) => page.getByTestId("scan-review");
const rows = (page: Page) => review(page).locator(".scan-row");
const logRow = (page: Page, title: string) => page.locator(".paper-row", { hasText: title });

test("the scan button opens the camera screen: title, frame, toggle, shutter, and close", async ({ page }) => {
  await page.goto(app.baseUrl);
  await page.getByRole("button", { name: "Scan a page" }).click();

  const screen = page.getByTestId("scan-screen");
  await expect(screen.getByRole("heading", { name: "Align the rapid log page" })).toBeVisible();
  await expect(screen.locator(".scan-frame")).toBeVisible();
  await expect(screen.locator("#scan-file")).toHaveAttribute("capture", "environment");
  await expect(screen.locator("#scan-file")).toHaveAttribute("accept", "image/*");
  await expect(screen.getByRole("button", { name: "Rapid log" })).toHaveAttribute("aria-pressed", "true");
  const note = screen.getByRole("button", { name: "Free note" });
  await expect(note).toHaveAttribute("aria-disabled", "true");
  await note.click({ force: true });
  await expect(note).toHaveAttribute("aria-pressed", "false");
  await expect(screen.getByRole("button", { name: "Take or choose a photo" })).toBeEnabled();

  await screen.getByRole("button", { name: "Close" }).click();
  await expect(screen).toHaveCount(0);
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
  await expect(page.getByTestId("scan-sub")).toHaveText(`${heading(day(0))} \u00b7 3 entries`);
  await expect(rows(page)).toHaveCount(3);
  await expect(rows(page).nth(0).locator('[data-field="title"]')).toHaveValue("Tasche für Stuttgart packen");
  await expect(rows(page).nth(0).locator(".scan-meta")).toHaveText("94%");
  await expect(rows(page).nth(1).locator(".scan-meta")).toHaveText("71% \u00b7 check spelling");
  await expect(rows(page).nth(1)).toHaveAttribute("data-low", "true");
  await expect(rows(page).nth(0)).toHaveAttribute("data-low", "false");
  await expect(review(page).locator("[data-action=apply]")).toHaveText("Apply 3 entries");

  // Nothing is in the log yet.
  const before = await page.request.get(`${app.baseUrl}/api/entries?from=${day(0)}&to=${day(0)}`);
  expect(JSON.stringify(await before.json())).not.toContain("Stuttgart");

  // Drop the second line, edit the third: its type, title and tag.
  await rows(page).nth(1).locator('[data-field="include"]').click();
  await expect(rows(page).nth(1)).toHaveAttribute("data-include", "false");
  await expect(review(page).locator("[data-action=apply]")).toHaveText("Apply 2 entries");
  await rows(page).nth(2).locator('[data-field="type"]').selectOption("task");
  await rows(page).nth(2).locator('[data-field="title"]').fill("Library card expires in January");
  await rows(page).nth(2).locator('[data-field="tag"]').fill("Errands");
  await review(page).locator("[data-action=apply]").click();

  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(logRow(page, "Tasche für Stuttgart packen")).toHaveAttribute("data-type", "task");
  const edited = logRow(page, "Library card expires in January");
  await expect(edited).toHaveAttribute("data-type", "task");
  await expect(edited.locator(".meta-text")).toHaveText("Errands");
  await expect(logRow(page, "Lunch with Mira")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("an x line marks the open task done instead of adding an entry, and a repeated title is skipped by default", async ({ page }) => {
  await seed(page, [
    { date: day(0), type: "task", title: "Water the office plants" },
    { date: day(0), type: "note", title: "Idee Wochenende" },
  ]);
  await scanPage(page, [headerLine(day(0)), line("x", "Water the office plants", 0.91), line("–", "Idee Wochenende", 0.9), line("•", "Brot kaufen", 0.9)]);

  await expect(rows(page).nth(0)).toHaveAttribute("data-status", "completes");
  await expect(rows(page).nth(0).locator(".scan-meta")).toHaveText("91% \u00b7 marks done");
  await expect(rows(page).nth(0)).toHaveAttribute("data-include", "true");
  await expect(rows(page).nth(1)).toHaveAttribute("data-status", "duplicate");
  await expect(rows(page).nth(1)).toHaveAttribute("data-include", "false");
  await expect(rows(page).nth(1).locator(".scan-meta")).toHaveText("90% \u00b7 already in log");
  await expect(review(page).locator("[data-action=apply]")).toHaveText("Apply 2 entries");

  await review(page).locator("[data-action=apply]").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(logRow(page, "Water the office plants")).toHaveCount(1);
  await expect(logRow(page, "Water the office plants")).toHaveAttribute("data-type", "done");
  await expect(logRow(page, "Idee Wochenende")).toHaveCount(1);
  await expect(logRow(page, "Brot kaufen")).toHaveAttribute("data-type", "task");
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
  await expect(rows(page).nth(0)).toHaveAttribute("data-status", "duplicate");
  await expect(rows(page).nth(0)).toHaveAttribute("data-include", "false");
  await expect(review(page).locator("[data-action=apply]")).toBeDisabled();
  await expect(review(page).locator("[data-action=apply]")).toHaveText("Apply 0 entries");

  // A hand ticked line keeps the person's choice, and it is applied to the day they picked.
  await rows(page).nth(0).locator('[data-field="include"]').click();
  await rows(page).nth(0).locator('[data-field="title"]').fill("Butter und Brot holen");
  await review(page).locator("[data-action=apply]").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(`.paper-day-group[data-date="${day(1)}"]`).locator(".paper-row", { hasText: "Butter und Brot" })).toHaveCount(1);
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
  await page.getByRole("button", { name: "Scan a page" }).click();
  const screen = page.getByTestId("scan-screen");

  await page.locator("#scan-file").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(screen.getByRole("alert")).toContainText("not a JPEG, PNG, WebP or HEIC photo");

  app.ocr.failWith(500);
  await page.locator("#scan-file").setInputFiles(photo);
  await expect(screen.getByRole("alert")).toBeVisible();
  await expect(screen.getByRole("button", { name: "Take or choose a photo" })).toBeEnabled();

  app.ocr.failWith(0);
  app.ocr.setLines([]);
  await page.locator("#scan-file").setInputFiles(photo);
  await expect(screen.getByRole("alert")).toContainText("No lines were read from this page.");
  await expect(screen).toBeVisible();

  app.ocr.setLines([line("•", "Doch noch", 0.9)]);
  await page.locator("#scan-file").setInputFiles(photo);
  await expect(page.getByTestId("scan-review")).toBeVisible();
});

test("a HEIC photo with no type is accepted, and the photo is never put in the page", async ({ page }) => {
  app.ocr.setLines([line("•", "Aus dem Foto", 0.9)]);
  await page.goto(app.baseUrl);
  await page.getByRole("button", { name: "Scan a page" }).click();
  await page.locator("#scan-file").setInputFiles({ name: "IMG_0001.HEIC", mimeType: "", buffer: PNG });
  await expect(page.getByTestId("scan-review")).toBeVisible();
  expect(await page.locator('[data-testid="scan-review"] :is(img, canvas, video)').count()).toBe(0);
  expect(await page.locator('[data-testid="scan-review"] [src], [data-testid="scan-review"] [style*="url("]').count()).toBe(0);
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
  await page.getByRole("button", { name: "Scan a page" }).click();
  await page.locator('[data-testid="scan-screen"] .scan-shutter').focus();
  const screen = await probe('[data-testid="scan-screen"]');
  expect(screen.accent.toLowerCase()).toBe(paperInk.toLowerCase());
  for (const pink of KIT_PINK) expect(screen.used).not.toContain(pink);
});
