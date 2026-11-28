import { expect, test, type Page } from "@playwright/test";
import { line } from "../fake-ocr.ts";
import { openSavedNote, useBujo } from "./harness.ts";
import { openScan } from "./scan-helpers.ts";

const app = useBujo();

// A 1x1 PNG. The fake OCR service ignores the pixels and answers the lines the test sets.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const photo = { name: "note.png", mimeType: "image/png", buffer: PNG };

const SAVED_BODY = "# Küchengarten\n- Beet 2: Rucola und Radieschen\n- Tomaten giessen";
const SCANNED = [line("none", "# Küchengarten"), line("•", "Beet 2: Rucola und Radieschen"), line("•", "Tomaten giessen"), line("•", "Kompost umschichten")];
const SCANNED_BODY = "# Küchengarten\n- Beet 2: Rucola und Radieschen\n- Tomaten giessen\n- Kompost umschichten";

test.beforeEach(async ({ page }) => {
  await app.signIn(page);
  app.ocr.failWith(0);
  app.ocr.delay(0);
});

/** Every entry of the days the tests use, and every free note, goes after each test, so each starts with no notes. */
test.afterEach(async ({ page }) => {
  const { entries } = await (await page.request.get(`${app.baseUrl}/api/entries?from=${day(-10)}&to=${day(1)}`)).json();
  const found = (await (await page.request.get(`${app.baseUrl}/api/entries?kind=notes`)).json()).entries;
  for (const entry of [...entries, ...found]) await page.request.delete(`${app.baseUrl}/api/entries/${entry.id}`);
});

/** A calendar day as YYYY-MM-DD in the local time zone, n days from today. */
function day(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const sheet = (page: Page) => page.getByTestId("note-sheet");
const screen = (page: Page) => page.getByTestId("scan-screen");
const matchRow = (page: Page) => sheet(page).getByTestId("note-match");

type Seeded = { id: string };

/** One saved free note, made through the API (fake data, the test list only). */
async function seedNote(page: Page, date: string, title: string, body: string): Promise<Seeded> {
  const response = await page.request.post(`${app.baseUrl}/api/entries`, { data: { date, type: "note", title, body } });
  expect(response.status()).toBe(201);
  return { id: (await response.json()).entry.id };
}

/** All notes between two days, as the API lists them. */
async function notes(page: Page): Promise<Array<{ id: string; title: string; body: string; date: string }>> {
  const response = await page.request.get(`${app.baseUrl}/api/entries?kind=notes`);
  return (await response.json()).entries;
}

/** Scans a free-form page from the Scan tab. The page is headed by a title, so the review starts on the note type. */
async function scanNote(page: Page): Promise<void> {
  await page.goto(app.baseUrl);
  await openScan(page);
  await page.locator("#scan-file").setInputFiles(photo);
  await expect(sheet(page)).toBeVisible();
}

test("a scan that looks like a saved note offers to update it, with Update chosen, and saves onto the same note", async ({ page }) => {
  const saved = await seedNote(page, day(-2), "Küchengarten", SAVED_BODY);
  app.ocr.setLines(SCANNED);
  await scanNote(page);

  await expect(matchRow(page)).toBeVisible();
  await expect(matchRow(page).getByTestId("note-match-text")).toContainText("Looks like your note \u201cKüchengarten\u201d from");
  await expect(matchRow(page).locator("[data-action=note-match-update]")).toHaveAttribute("aria-pressed", "true");
  await expect(matchRow(page).locator("[data-action=note-match-new]")).toHaveAttribute("aria-pressed", "false");
  await expect(sheet(page).locator('[data-field="body"]')).toHaveValue(SCANNED_BODY);
  await expect(sheet(page).locator('[data-field="date"]')).toHaveValue(day(-2));
  expect(await notes(page)).toHaveLength(1);

  await sheet(page).locator("[data-action=save-note]").click();
  await expect(sheet(page)).toHaveCount(0);
  const after = await notes(page);
  expect(after).toHaveLength(1);
  expect(after[0].id).toBe(saved.id);
  expect(after[0].body).toBe(SCANNED_BODY);
  expect(after[0].date).toBe(day(-2));
});

test("Save as new keeps the saved note and makes a second one", async ({ page }) => {
  const saved = await seedNote(page, day(-2), "Küchengarten", SAVED_BODY);
  app.ocr.setLines(SCANNED);
  await scanNote(page);
  await matchRow(page).locator("[data-action=note-match-new]").click();
  await expect(matchRow(page).locator("[data-action=note-match-new]")).toHaveAttribute("aria-pressed", "true");
  await expect(sheet(page).locator('[data-field="date"]')).toHaveValue(day(0));

  await sheet(page).locator("[data-action=save-note]").click();
  await expect(sheet(page)).toHaveCount(0);
  const after = await notes(page);
  expect(after).toHaveLength(2);
  expect(after.find((note) => note.id === saved.id)!.body).toBe(SAVED_BODY);
  expect(after.find((note) => note.id !== saved.id)!.body).toBe(SCANNED_BODY);
});

test("cancelling the review of a matching scan writes nothing", async ({ page }) => {
  const saved = await seedNote(page, day(-2), "Küchengarten", SAVED_BODY);
  app.ocr.setLines(SCANNED);
  await scanNote(page);
  await sheet(page).locator("[data-action=note-cancel]").click();
  await expect(sheet(page)).toHaveCount(0);
  const after = await notes(page);
  expect(after.map((note) => [note.id, note.body])).toEqual([[saved.id, SAVED_BODY]]);
});

test("a note that matches nothing shows no match row", async ({ page }) => {
  await seedNote(page, day(-2), "Steuer", "- Belege sammeln\n- Formular ausfuellen");
  app.ocr.setLines(SCANNED);
  await scanNote(page);
  await expect(matchRow(page)).toHaveCount(0);
});

test("Scan again on a saved note opens the note camera, ends in the review with Update chosen, and Save changes the same note", async ({ page }) => {
  const saved = await seedNote(page, day(-2), "Küchengarten", SAVED_BODY);
  await openSavedNote(page, app.baseUrl, "Küchengarten");
  await expect(sheet(page)).toHaveAttribute("data-mode", "saved");
  await expect(matchRow(page)).toHaveCount(0);

  // The page read is unrelated to the saved text: an explicit rescan still names that note.
  app.ocr.setLines([line("none", "Gartenplan neu"), line("•", "Zaun streichen")]);
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), sheet(page).locator("[data-action=rescan-note]").click()]);
  await expect(screen(page)).toBeVisible();
  await chooser.setFiles(photo);
  // The saved sheet may still be leaving while the review comes up, so the review is picked by its mode.
  const review = page.locator("[data-testid=note-sheet][data-mode=review]");
  await expect(review).toBeVisible();
  await expect(review.getByTestId("note-match-text")).toContainText("Scanning your note \u201cKüchengarten\u201d from");
  await expect(review.locator("[data-action=note-match-update]")).toHaveAttribute("aria-pressed", "true");

  await review.locator("[data-action=save-note]").click();
  await expect(sheet(page)).toHaveCount(0);
  const after = await notes(page);
  expect(after).toHaveLength(1);
  expect(after[0].id).toBe(saved.id);
  expect(after[0].title).toBe("Gartenplan neu");
  expect(after[0].body).toBe("Gartenplan neu\n- Zaun streichen");
});

test("closing the camera of Scan again writes nothing", async ({ page }) => {
  const saved = await seedNote(page, day(-2), "Küchengarten", SAVED_BODY);
  await openSavedNote(page, app.baseUrl, "Küchengarten");
  await Promise.all([page.waitForEvent("filechooser"), sheet(page).locator("[data-action=rescan-note]").click()]);
  await screen(page).locator("[data-action=scan-close]").click();
  await expect(screen(page)).toHaveCount(0);
  expect((await notes(page)).map((note) => [note.id, note.body])).toEqual([[saved.id, SAVED_BODY]]);
});

test("the day page offers Scan this page again only when the day has an entry on paper, and a photo of its lines is matched, not new", async ({ page }) => {
  const past = day(-3);
  const made = await page.request.post(`${app.baseUrl}/api/entries`, { data: { date: past, type: "task", title: "Semmeln kaufen" } });
  const id = (await made.json()).entry.id;
  await page.goto(`${app.baseUrl}/?day=${past}`);
  await expect(page.locator(".paper-row", { hasText: "Semmeln kaufen" })).toHaveAttribute("data-on-paper", "false");
  await expect(page.getByTestId("rescan-page")).toHaveCount(0);

  expect((await page.request.post(`${app.baseUrl}/api/entries/${id}/written`)).status()).toBe(200);
  await page.goto(`${app.baseUrl}/?day=${past}`);
  const link = page.getByTestId("rescan-page");
  await expect(link).toHaveText("Scan this page again");

  // The photo names no date: it files on the page being scanned again, not on today.
  app.ocr.setLines([line("•", "Semmeln kaufen", 0.9), line("•", "Post abholen", 0.9)]);
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), link.click()]);
  await chooser.setFiles(photo);
  const review = page.getByTestId("scan-review");
  await expect(review).toBeVisible();
  await expect(review.locator(".scan-row")).toHaveCount(2);
  await expect(review.locator('.scan-row[data-status="unchanged"]')).toHaveCount(1);
  await expect(review.locator('.scan-row[data-status="new"]')).toHaveCount(1);
  await expect(review.locator(".scan-row").first().locator('[data-role="note"]')).toContainText("matches");

  await review.locator("[data-action=apply]").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const stored = await page.request.get(`${app.baseUrl}/api/entries?from=${past}&to=${past}`);
  const titles = (await stored.json()).entries.map((entry: { title: string }) => entry.title).sort();
  expect(titles).toEqual(["Post abholen", "Semmeln kaufen"]);
});
