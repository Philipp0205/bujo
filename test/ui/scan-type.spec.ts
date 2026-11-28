import { expect, test, type Page } from "@playwright/test";
import { line } from "../fake-ocr.ts";
import { pinClock, pinnedDay, useBujo } from "./harness.ts";
import { choose, openScan, picker, pickStep } from "./scan-helpers.ts";

const app = useBujo();

// A 1x1 PNG. The fake OCR service ignores the pixels and answers the lines the test sets.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const photo = { name: "page.png", mimeType: "image/png", buffer: PNG };

const FREE_FORM = [line("none", "Reading list"), line("•", "Dune"), line("•", "Solaris")];
const LOG_PAGE = [line("•", "Brot kaufen", 0.9), line("•", "Post abholen", 0.9)];

test.beforeEach(async ({ page }) => {
  await pinClock(page);
  await app.signIn(page);
  app.ocr.failWith(0);
  app.ocr.delay(0);
  app.ocr.setPage(null);
});

/** Every entry of the days the tests use goes after each test, so each starts empty. */
test.afterEach(async ({ page }) => {
  for (const entry of await entriesAround(page)) await page.request.delete(`${app.baseUrl}/api/entries/${entry.id}`);
});

/** A calendar day as YYYY-MM-DD in the local time zone, n days from today. */
const day = pinnedDay;

type Stored = { id: string; type: string; title: string; body: string | null; noteKind: string | null };

/** All entries of the days around today plus every free note (notes are on no day), as the API lists them. */
async function entriesAround(page: Page): Promise<Stored[]> {
  const days = (await (await page.request.get(`${app.baseUrl}/api/entries?from=${day(-3)}&to=${day(3)}`)).json()).entries;
  const notes = (await (await page.request.get(`${app.baseUrl}/api/entries?kind=notes`)).json()).entries;
  return [...days, ...notes];
}

const review = (page: Page) => page.getByTestId("scan-review");
const noteSheet = (page: Page) => page.getByTestId("note-sheet");
/** The type the picker shows (its first word): "log" or "collection". */
const typeOf = (page: Page) => pickStep(page, "type");

/** How many times the OCR service was called so far. */
const ocrCalls = () => app.ocr.requests.filter((request) => request.path === "/ocr").length;

/** Scans a page with the default settings (nothing chosen on the camera screen). */
async function scan(page: Page, lines: ReturnType<typeof line>[]): Promise<void> {
  app.ocr.setLines(lines);
  await page.goto(app.baseUrl);
  const chooser = await openScan(page);
  await chooser.setFiles(photo);
}

test("a free-form page scanned with default settings opens on the note type, and saving ends with a note and no log lines", async ({ page }) => {
  await scan(page, FREE_FORM);
  await expect(noteSheet(page)).toBeVisible();
  await expect(review(page)).toHaveCount(0);
  await expect(typeOf(page)).toHaveAttribute("data-value", "collection");
  await expect(picker(page)).toHaveAttribute("data-source", "title");
  await expect(pickStep(page, "sub")).toHaveAttribute("data-value", "misc");
  await expect(noteSheet(page).locator('[data-field="title"]')).toHaveValue("Reading list");

  await noteSheet(page).locator("[data-action=save-note]").click();
  await expect(noteSheet(page)).toHaveCount(0);
  const stored = await entriesAround(page);
  expect(stored.map((entry) => entry.type)).toEqual(["note"]);
  expect(stored[0].body).toBe("Reading list\n- Dune\n- Solaris");
  // The note stands on its own: the person lands on the Notes tab and the day of the log has no such row.
  await expect(page.getByTestId("notebook-row").first()).toBeVisible();
  const onDay = await page.request.get(`${app.baseUrl}/api/entries?from=${day(-3)}&to=${day(3)}`);
  expect((await onDay.json()).entries).toEqual([]);
});

test("a bullet page opens on the log type, and flipping it to note shows the note from the same read and saves a note only", async ({ page }) => {
  const before = ocrCalls();
  await scan(page, LOG_PAGE);
  await expect(review(page)).toBeVisible();
  await expect(typeOf(page)).toHaveAttribute("data-value", "log");
  await expect(picker(page)).toHaveAttribute("data-source", "bullets");

  await choose(page, "type", "Collection");
  await expect(noteSheet(page)).toBeVisible();
  await expect(review(page)).toHaveCount(0);
  await expect(typeOf(page)).toHaveAttribute("data-value", "collection");
  await expect(picker(page)).toHaveAttribute("data-source", "picked");
  await expect(noteSheet(page).locator('[data-field="body"]')).toHaveValue("- Brot kaufen\n- Post abholen");
  expect(ocrCalls() - before).toBe(1);

  await noteSheet(page).locator("[data-action=save-note]").click();
  await expect(noteSheet(page)).toHaveCount(0);
  expect((await entriesAround(page)).map((entry) => entry.type)).toEqual(["note"]);
});

test("a free-form guess flipped to log shows the log review from the same read and saves log lines only", async ({ page }) => {
  const before = ocrCalls();
  await scan(page, FREE_FORM);
  await expect(noteSheet(page)).toBeVisible();

  await choose(page, "type", "Log");
  await expect(review(page)).toBeVisible();
  await expect(noteSheet(page)).toHaveCount(0);
  await expect(typeOf(page)).toHaveAttribute("data-value", "log");
  await expect(picker(page)).toHaveAttribute("data-source", "picked");
  await expect(review(page).locator(".scan-row")).toHaveCount(3);
  expect(ocrCalls() - before).toBe(1);

  await review(page).locator("[data-action=apply]").click();
  await expect(review(page)).toHaveCount(0);
  const stored = await entriesAround(page);
  expect(stored.length).toBeGreaterThan(0);
  expect(stored.some((entry) => entry.type === "note")).toBe(false);
});

test("switching to note and back keeps the log review edits", async ({ page }) => {
  await scan(page, LOG_PAGE);
  await review(page).locator(".scan-row").first().locator('[data-field="title"]').fill("Brot und Butter");
  await choose(page, "type", "Collection");
  await expect(noteSheet(page)).toBeVisible();
  await choose(page, "type", "Log");
  await expect(review(page).locator(".scan-row").first().locator('[data-field="title"]')).toHaveValue("Brot und Butter");
  await expect(picker(page)).toHaveAttribute("data-source", "bullets");
});

test("the collection kind picked in the picker is saved with the note and comes back from the API", async ({ page }) => {
  await scan(page, FREE_FORM);
  await expect(noteSheet(page)).toBeVisible();
  await choose(page, "sub", "tracker");
  await expect(pickStep(page, "sub")).toHaveAttribute("data-value", "tracker");
  await expect(pickStep(page, "target")).toHaveCount(0);

  await noteSheet(page).locator("[data-action=save-note]").click();
  await expect(noteSheet(page)).toHaveCount(0);
  const stored = await entriesAround(page);
  expect(stored.map((entry) => entry.noteKind)).toEqual(["tracker"]);
});

test("the picker keeps the picked collection kind when the page flips to log and back", async ({ page }) => {
  await scan(page, FREE_FORM);
  await choose(page, "sub", "project");
  await choose(page, "type", "Log");
  await expect(review(page)).toBeVisible();
  await choose(page, "type", "Collection");
  await expect(pickStep(page, "sub")).toHaveAttribute("data-value", "project");
});
