import { expect, test, type Page } from "@playwright/test";
import { useBujo } from "./harness.ts";

const app = useBujo();

test.beforeEach(async ({ page }) => {
  await app.signIn(page);
  // The install banner would sit over the page, so it is dismissed for the session before any page script runs.
  await page.addInitScript(() => sessionStorage.setItem("ak-install-prompt-dismissed", "1"));
  await clearNotes(page);
});

/** Removes the notes of the test app's own database, so each test starts from none. Local only, never Nextcloud. */
async function clearNotes(page: Page): Promise<void> {
  const list = await page.request.get(`${app.baseUrl}/api/entries?kind=notes`);
  for (const entry of (await list.json()).entries as Array<{ id: string }>) {
    const gone = await page.request.delete(`${app.baseUrl}/api/entries/${entry.id}`);
    expect(gone.status()).toBe(200);
  }
}

/** Fake notes, oldest first. The list shows the newest created first, so the screen reads them in reverse. */
const NOTES = [
  { title: "Kitchen garden", body: "Beds, herbs and seeds", photo: true },
  { title: "Watering plan", body: "Mornings only", photo: true },
  { title: "Weekend notes", body: "Nothing planned", photo: false },
];
const SHOWN = ["Weekend notes", "Watering plan", "Kitchen garden"];

/** A small real JPEG, drawn in the page, so a card can decode it. No picture file is committed. */
async function makeJpeg(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 90;
    canvas.height = 120;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#7a8f6a";
    context.fillRect(0, 0, 90, 120);
    context.fillStyle = "#e8dfc8";
    context.fillRect(12, 18, 66, 8);
    context.fillRect(12, 40, 50, 8);
    const blob: Blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.8));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let text = "";
    bytes.forEach((byte) => { text += String.fromCharCode(byte); });
    return btoa(text);
  });
  return Buffer.from(base64, "base64");
}

/** Creates the fake notes through the API with the page's session. Notes marked photo get a stored JPEG. */
async function seedNotes(page: Page): Promise<void> {
  await page.goto(app.baseUrl);
  // Let the log's own background reads finish, so none of them lands in the cache after the notes are seeded.
  await page.waitForLoadState("networkidle");
  const jpeg = await makeJpeg(page);
  for (const note of NOTES) {
    const created = await page.request.post(`${app.baseUrl}/api/entries`, { data: { date: "2026-11-20", type: "note", title: note.title, body: note.body } });
    expect(created.status()).toBe(201);
    if (!note.photo) continue;
    const id = ((await created.json()) as { entry: { id: string } }).entry.id;
    const stored = await page.request.post(`${app.baseUrl}/api/entries/${id}/photo`, { data: jpeg, headers: { "content-type": "image/jpeg" } });
    expect(stored.status()).toBe(200);
  }
}

const bar = (page: Page) => page.getByRole("navigation", { name: "Main" });
const tab = (page: Page, id: string) => bar(page).locator(`[data-tab=${id}]`);
const grid = (page: Page) => page.getByTestId("note-grid");
const card = (page: Page, title: string) => grid(page).locator(".note-card", { hasText: title });
const noteSheet = (page: Page) => page.getByTestId("note-sheet");
const markOf = (page: Page, title: string) => card(page, title).getByTestId("not-on-paper-mark");

/** A calendar day as YYYY-MM-DD in the local time zone, n days from today (the page uses the local day too). */
function day(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Fake notes on chosen days; the ones named in written are marked as on paper. No photo: placeholders only. */
async function seedDated(page: Page, notes: Array<{ title: string; date: string }>, written: string[] = []): Promise<void> {
  for (const note of notes) {
    const created = await page.request.post(`${app.baseUrl}/api/entries`, { data: { date: note.date, type: "note", title: note.title, body: "x" } });
    expect(created.status()).toBe(201);
    const id = ((await created.json()) as { entry: { id: string } }).entry.id;
    if (written.includes(note.title)) expect((await page.request.post(`${app.baseUrl}/api/entries/${id}/written`)).status()).toBe(200);
  }
}

const DATED = [
  { title: "Frische Idee", date: day(0) },
  { title: "Schon notiert", date: day(0) },
  { title: "Grenze", date: day(-14) },
  { title: "Zu alt", date: day(-15) },
  { title: "Spaeter", date: day(3) },
];

test("a note not on paper wears the dashed page mark; a written one, and one older than 14 days, do not", async ({ page }) => {
  await seedDated(page, DATED, ["Schon notiert"]);
  await page.goto(`${app.baseUrl}/notes`);
  await expect(grid(page).locator(".note-card")).toHaveCount(5);
  await expect(markOf(page, "Frische Idee")).toHaveCount(1);
  await expect(markOf(page, "Frische Idee")).toHaveAttribute("aria-label", "Not on paper yet");
  await expect(markOf(page, "Frische Idee")).toHaveClass(/paper-off/);
  await expect(markOf(page, "Frische Idee").locator("svg use")).toHaveAttribute("href", "#g-unwritten");
  await expect(markOf(page, "Grenze")).toHaveCount(1);
  await expect(markOf(page, "Spaeter")).toHaveCount(1);
  await expect(markOf(page, "Schon notiert")).toHaveCount(0);
  await expect(markOf(page, "Zu alt")).toHaveCount(0);
});

test("the mark is drawn on a cold load of /notes: the icon has a size and the muted paper colour", async ({ page }) => {
  await seedDated(page, [{ title: "Frische Idee", date: day(0) }]);
  await page.goto(`${app.baseUrl}/notes`);
  const mark = markOf(page, "Frische Idee");
  await expect(mark).toBeVisible();
  const box = await mark.locator("svg").boundingBox();
  expect(Math.round(box!.width)).toBe(16);
  expect(await page.evaluate(() => document.getElementById("g-unwritten") !== null)).toBe(true);
  const colors = await mark.evaluate((node) => [getComputedStyle(node).color, getComputedStyle(document.documentElement).getPropertyValue("--paper-muted").trim()]);
  expect(colors[0]).not.toBe("");
  const probe = await page.evaluate(() => { const el = document.createElement("i"); el.style.color = getComputedStyle(document.documentElement).getPropertyValue("--paper-muted"); document.body.appendChild(el); const c = getComputedStyle(el).color; el.remove(); return c; });
  expect(colors[0]).toBe(probe);
});

test("the mark also shows after switching from the log to Notes", async ({ page }) => {
  await seedDated(page, [{ title: "Frische Idee", date: day(0) }]);
  await page.goto(app.baseUrl);
  await tab(page, "notes").click();
  await expect(markOf(page, "Frische Idee")).toBeVisible();
  expect(Math.round((await markOf(page, "Frische Idee").locator("svg").boundingBox())!.width)).toBe(16);
});

test("the log has the bar with Daily log active, and Notes leads to the notes screen", async ({ page }) => {
  await page.goto(app.baseUrl);
  await expect(bar(page).locator(".ak-tab")).toHaveText(["Daily log", "Notes", "Add", "Scan", "Account"]);
  await expect(tab(page, "log")).toHaveAttribute("aria-current", "page");

  await tab(page, "notes").click();
  await expect(page).toHaveURL(`${app.baseUrl}/notes`);
  await expect(page.getByRole("heading", { name: "Notes", level: 1 })).toBeVisible();
  await expect(tab(page, "notes")).toHaveAttribute("aria-current", "page");
  await expect(tab(page, "log")).not.toHaveAttribute("aria-current", "page");
});

test("there is no settings link in the log header, and Account opens settings with Account active", async ({ page }) => {
  await page.goto(app.baseUrl);
  await expect(page.getByRole("heading", { name: "Daily Log", level: 1 })).toBeVisible();
  await expect(page.locator(".paper-head [data-nav=settings]")).toHaveCount(0);
  await expect(page.locator(".paper-head a")).toHaveCount(0);
  await expect(page.locator("[data-action=scan]")).toHaveCount(0);

  await tab(page, "account").click();
  await expect(page).toHaveURL(`${app.baseUrl}/settings`);
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  await expect(tab(page, "account")).toHaveAttribute("aria-current", "page");
});

test("the notes grid shows a card per note, newest first: a photo or a placeholder, and the title", async ({ page }) => {
  await seedNotes(page);
  await page.goto(`${app.baseUrl}/notes`);

  await expect(grid(page).locator(".note-card")).toHaveCount(3);
  await expect(grid(page).locator(".note-title")).toHaveText(SHOWN);
  await expect(card(page, "Kitchen garden").getByTestId("note-photo")).toHaveAttribute("src", /^\/api\/entries\/[^/]+\/photo$/);
  await expect(card(page, "Watering plan").getByTestId("note-photo")).toBeVisible();
  await expect(card(page, "Weekend notes").getByTestId("note-placeholder")).toBeVisible();
  await expect(card(page, "Weekend notes").getByTestId("note-photo")).toHaveCount(0);
  // The photos really load: they were stored as JPEGs, so the browser decodes them.
  const photo = card(page, "Kitchen garden").getByTestId("note-photo");
  await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(90);
});

/** Opens /notes and waits until the three seeded cards are drawn, their photos decoded and the fonts in, so geometry and taps are stable. */
async function openNotes(page: Page): Promise<void> {
  await page.goto(`${app.baseUrl}/notes`);
  await expect(grid(page).locator(".note-card")).toHaveCount(3);
  await expect.poll(() => grid(page).locator("img").evaluateAll((imgs) => imgs.every((img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}

test("the grid has two columns", async ({ page }) => {
  await seedNotes(page);
  await openNotes(page);
  const boxes = await grid(page).locator(".note-card").evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => ({ x: Math.round(r.x), y: Math.round(r.y) })));
  expect(boxes[0].y).toBe(boxes[1].y);
  expect(boxes[1].x).toBeGreaterThan(boxes[0].x);
  expect(boxes[2].x).toBe(boxes[0].x);
  expect(boxes[2].y).toBeGreaterThan(boxes[0].y);
});

test("a tap on a card opens its note sheet", async ({ page }) => {
  await seedNotes(page);
  await openNotes(page);
  await card(page, "Watering plan").click();
  await expect(noteSheet(page)).toBeVisible();
  await expect(noteSheet(page).locator('[data-field="title"]')).toHaveValue("Watering plan");
});

test("Back from the notes screen returns to the log", async ({ page }) => {
  await page.goto(app.baseUrl);
  await tab(page, "notes").click();
  await expect(page).toHaveURL(`${app.baseUrl}/notes`);

  await page.goBack();
  await expect(page).toHaveURL(`${app.baseUrl}/`);
  await expect(page.getByRole("heading", { name: "Daily Log", level: 1 })).toBeVisible();
});

test("with a note sheet open, the first Back closes the sheet and stays on Notes, the second returns to the log", async ({ page }) => {
  await seedNotes(page);
  await page.goto(app.baseUrl);
  await tab(page, "notes").click();
  await card(page, "Weekend notes").click();
  await expect(noteSheet(page)).toBeVisible();

  await page.goBack();
  await expect(noteSheet(page)).toHaveCount(0);
  await expect(page).toHaveURL(`${app.baseUrl}/notes`);
  await expect(grid(page)).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(`${app.baseUrl}/`);
  await expect(page.getByRole("heading", { name: "Daily Log", level: 1 })).toBeVisible();
});

test("notes opened first sends Back to the log", async ({ page }) => {
  await page.goto(app.baseUrl);
  // A popup has no earlier history entry, like the installed app started on this page.
  const [first] = await Promise.all([
    page.waitForEvent("popup"),
    page.evaluate((url) => { window.open(url); }, `${app.baseUrl}/notes`),
  ]);
  await expect(first.getByRole("heading", { name: "Notes", level: 1 })).toBeVisible();
  expect(await first.evaluate(() => history.length)).toBe(2);

  await first.goBack();
  await expect(first).toHaveURL(`${app.baseUrl}/`);
  await expect(first.getByRole("heading", { name: "Daily Log", level: 1 })).toBeVisible();
});

test("switching between Notes and Account does not stack pages: Back from Account lands on the log", async ({ page }) => {
  await page.goto(app.baseUrl);
  await tab(page, "notes").click();
  await expect(page).toHaveURL(`${app.baseUrl}/notes`);
  await tab(page, "account").click();
  await expect(page).toHaveURL(`${app.baseUrl}/settings`);

  await page.goBack();
  await expect(page).toHaveURL(`${app.baseUrl}/`);
});
