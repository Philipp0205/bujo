import { expect, test, type Page } from "@playwright/test";
import { deflateSync } from "node:zlib";
import { line } from "../fake-ocr.ts";
import { useBujo } from "./harness.ts";

const app = useBujo();

// A 1x1 PNG. The fake OCR service ignores the pixels and answers the lines the test sets.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const photo = { name: "note.png", mimeType: "image/png", buffer: PNG };
const PAGE = [line("none", "# Küchengarten, Frühjahr"), line("•", "Beet 2: Rucola und Radieschen"), line("none", "Next: sketch a watering plan.")];
const MARKDOWN = "# Küchengarten, Frühjahr\n- Beet 2: Rucola und Radieschen\nNext: sketch a watering plan.";

test.beforeEach(async ({ page }) => {
  await app.signIn(page);
  app.ocr.failWith(0);
  app.ocr.setLines(PAGE);
});

/** Today as YYYY-MM-DD in the local time zone: the log page uses the local day too. */
function localDay(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const sheet = (page: Page) => page.getByTestId("note-sheet");
const screen = (page: Page) => page.getByTestId("scan-screen");

/** Opens the camera screen in free-note mode. */
async function openNoteCamera(page: Page): Promise<void> {
  await page.goto(app.baseUrl);
  await page.getByRole("button", { name: "Scan a page" }).click();
  await screen(page).getByRole("button", { name: "Free note" }).click();
}

/** Scans a photo in free-note mode, through the given input. The review sheet is up after this. */
async function scanNote(page: Page, input = "#scan-file"): Promise<void> {
  await openNoteCamera(page);
  await page.locator(input).setInputFiles(photo);
  await expect(sheet(page)).toBeVisible();
}

test("the Free note toggle works: pressed state and title follow it, and back again", async ({ page }) => {
  await page.goto(app.baseUrl);
  await page.getByRole("button", { name: "Scan a page" }).click();
  const rapid = screen(page).getByRole("button", { name: "Rapid log" });
  const note = screen(page).getByRole("button", { name: "Free note" });
  await expect(screen(page).getByRole("heading", { name: "Align the rapid log page" })).toBeVisible();

  await note.click();
  await expect(note).toHaveAttribute("aria-pressed", "true");
  await expect(rapid).toHaveAttribute("aria-pressed", "false");
  await expect(screen(page).getByRole("heading", { name: "Align the note page" })).toBeVisible();
  await expect(screen(page).locator(".scan-frame use")).toHaveAttribute("href", "#g-scan-prose");

  await rapid.click();
  await expect(rapid).toHaveAttribute("aria-pressed", "true");
  await expect(screen(page).getByRole("heading", { name: "Align the rapid log page" })).toBeVisible();
  await expect(screen(page).locator(".scan-frame use")).toHaveAttribute("href", "#g-scan-guide");
});

test("a free-note photo reaches the review with the transcribed markdown, and nothing is written yet", async ({ page }) => {
  await scanNote(page);
  await expect(page.getByTestId("scan-screen")).toHaveCount(0);
  await expect(sheet(page).getByRole("heading", { name: "Free note" })).toBeVisible();
  await expect(sheet(page).locator('[data-field="title"]')).toHaveValue("Küchengarten, Frühjahr");
  await expect(sheet(page).locator('[data-field="body"]')).toHaveValue(MARKDOWN);
  await expect(sheet(page).locator('[data-field="date"]')).not.toHaveValue("");
  await expect(sheet(page).getByText(/obsidian|vault|inbox/i)).toHaveCount(0);

  const date = await sheet(page).locator('[data-field="date"]').inputValue();
  const stored = await page.request.get(`${app.baseUrl}/api/entries?from=${date}&to=${date}`);
  expect(JSON.stringify(await stored.json())).not.toContain("Küchengarten");
});

test("the gallery input works in free-note mode too", async ({ page }) => {
  await scanNote(page, "#scan-gallery");
  await expect(sheet(page).locator('[data-field="body"]')).toHaveValue(MARKDOWN);
});

test("cancel and Escape drop the draft and write nothing", async ({ page }) => {
  await scanNote(page);
  await sheet(page).locator('[data-field="title"]').fill("Nur im Review");
  await sheet(page).locator('[data-action="note-cancel"]').click();
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.locator(".paper-row", { hasText: "Nur im Review" })).toHaveCount(0);

  await scanNote(page);
  await sheet(page).locator('[data-field="title"]').fill("Auch nur im Review");
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveCount(0);
  const today = localDay();
  const list = await page.request.get(`${app.baseUrl}/api/entries?from=${today}&to=${today}`);
  expect(JSON.stringify(await list.json())).not.toContain("im Review");
});

test("a page with no readable text stays on the camera screen with a message", async ({ page }) => {
  app.ocr.setLines([line("none", "   ")]);
  await openNoteCamera(page);
  await page.locator("#scan-file").setInputFiles(photo);
  await expect(screen(page).getByRole("alert")).toContainText("No text was read from this page.");
  await expect(screen(page)).toBeVisible();
});

test("edit title and markdown, save, see the note in the log, open it, copy it, edit it again", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await scanNote(page);

  await sheet(page).locator('[data-field="title"]').fill("Garten im Frühjahr");
  await sheet(page).locator('[data-field="body"]').fill(`${MARKDOWN}\n- Kompost umschichten`);
  await sheet(page).locator('[data-action="save-note"]').click();
  await expect(sheet(page)).toHaveCount(0);

  const row = page.locator(".paper-row", { hasText: "Garten im Frühjahr" });
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute("data-type", "note");
  await expect(row).toHaveAttribute("data-sync", "local");
  await expect(row.locator(".sync-mark")).toHaveCount(0);
  await expect(row).not.toContainText(/not synced/i);

  await row.click();
  await expect(sheet(page)).toHaveAttribute("data-mode", "saved");
  await expect(sheet(page).locator('[data-field="title"]')).toHaveValue("Garten im Frühjahr");
  await expect(sheet(page).locator(".sync-mark, [data-testid=sync-line]")).toHaveCount(0);
  await expect(sheet(page)).not.toContainText(/not synced/i);
  await expect(sheet(page).locator('[data-field="body"]')).toHaveValue(`${MARKDOWN}\n- Kompost umschichten`);

  const copy = sheet(page).locator('[data-action="copy-note"]');
  await expect(copy).toHaveText("Copy markdown");
  await copy.click();
  await expect(copy).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${MARKDOWN}\n- Kompost umschichten`);

  await sheet(page).locator('[data-field="body"]').fill("# Neu\n- nur das");
  await sheet(page).locator('[data-action="save-note"]').click();
  await expect(sheet(page)).toHaveCount(0);
  await page.locator(".paper-row", { hasText: "Garten im Frühjahr" }).click();
  await expect(sheet(page).locator('[data-field="body"]')).toHaveValue("# Neu\n- nur das");
  expect(errors).toEqual([]);
});

test("a note needs a title and some text", async ({ page }) => {
  await scanNote(page);
  await sheet(page).locator('[data-field="title"]').fill("");
  await sheet(page).locator('[data-action="save-note"]').click();
  await expect(sheet(page).getByRole("alert")).toContainText("Give the note a title.");
  await sheet(page).locator('[data-field="title"]').fill("Titel");
  await sheet(page).locator('[data-field="body"]').fill("  ");
  await sheet(page).locator('[data-action="save-note"]').click();
  await expect(sheet(page).getByRole("alert")).toContainText("Write something in the note.");
  await expect(sheet(page)).toBeVisible();
});

test("a page with no usable first line gets the Untitled note title", async ({ page }) => {
  app.ocr.setLines([line("none", "#"), line("none", "zweite Zeile")]);
  await scanNote(page);
  await expect(sheet(page).locator('[data-field="title"]')).toHaveValue("Untitled note");
});

/** A solid grey PNG of the given size, made here so no real page photo is ever used. */
function greyPng(width: number, height: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: Buffer) => {
    let c = 0xffffffff;
    for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc(body));
    return Buffer.concat([head, body, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  const rows = Buffer.alloc((width + 1) * height, 0x90);
  for (let y = 0; y < height; y++) rows[y * (width + 1)] = 0; // filter type none
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

/** The width and height in the first start-of-frame marker of a JPEG. */
function jpegSize(bytes: Buffer): { width: number; height: number } {
  let at = 2;
  while (at < bytes.length) {
    const marker = bytes[at + 1];
    if (marker >= 0xc0 && marker <= 0xc3) return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) };
    at += 2 + bytes.readUInt16BE(at + 2);
  }
  throw new Error("no JPEG frame");
}

test("the photo shows on the review sheet, is stored with the note as a JPEG of at most 2000px, and shows on the saved sheet", async ({ page }) => {
  const big = { name: "page.png", mimeType: "image/png", buffer: greyPng(3000, 1500) };
  await openNoteCamera(page);
  await page.locator("#scan-file").setInputFiles(big);
  await expect(sheet(page)).toBeVisible();
  const review = sheet(page).getByTestId("note-photo");
  await expect(review).toBeVisible();
  await expect(review).toHaveAttribute("src", /^data:image\/jpeg/);

  await sheet(page).locator('[data-field="title"]').fill("Mit Foto");
  await sheet(page).locator('[data-action="save-note"]').click();
  await expect(sheet(page)).toHaveCount(0);

  await page.locator(".paper-row", { hasText: "Mit Foto" }).click();
  await expect(sheet(page)).toHaveAttribute("data-mode", "saved");
  const saved = sheet(page).getByTestId("note-photo");
  await expect(saved).toBeVisible();
  await expect(saved).toHaveAttribute("src", /^\/api\/entries\/[^/]+\/photo$/);
  await expect.poll(() => saved.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(2000);

  const src = (await saved.getAttribute("src"))!;
  const served = await page.request.get(`${app.baseUrl}${src}`);
  expect(served.status()).toBe(200);
  expect(served.headers()["content-type"]).toBe("image/jpeg");
  expect(jpegSize(await served.body())).toEqual({ width: 2000, height: 1000 });
});

test("a tap on the photo opens it full size; the close button, a tap and Escape close it and keep the note sheet", async ({ page }) => {
  await scanNote(page);
  const view = page.getByTestId("photo-view");
  await sheet(page).locator('[data-action="open-photo"]').click();
  await expect(view).toBeVisible();
  await expect(view.locator("img")).toBeVisible();
  await view.locator('[data-action="photo-close"]').click();
  await expect(view).toHaveCount(0);

  await sheet(page).locator('[data-action="open-photo"]').click();
  await view.locator("img").click();
  await expect(view).toHaveCount(0);

  await sheet(page).locator('[data-action="open-photo"]').click();
  await page.keyboard.press("Escape");
  await expect(view).toHaveCount(0);
  await expect(sheet(page)).toBeVisible();
});

test("saving a saved note again keeps its photo, and a note with no photo shows none", async ({ page }) => {
  await scanNote(page);
  await sheet(page).locator('[data-action="save-note"]').click();
  await expect(sheet(page)).toHaveCount(0);
  await page.locator(".paper-row", { hasText: "Küchengarten, Frühjahr" }).click();
  await sheet(page).locator('[data-field="body"]').fill("# Neu\n- nur das");
  await sheet(page).locator('[data-action="save-note"]').click();
  await expect(sheet(page)).toHaveCount(0);
  await page.locator(".paper-row", { hasText: "Küchengarten, Frühjahr" }).click();
  await expect(sheet(page).getByTestId("note-photo")).toBeVisible();

  const made = await page.request.post(`${app.baseUrl}/api/entries`, { data: { date: localDay(), type: "note", title: "Ohne Foto", body: "# nur Text" } });
  expect(made.status()).toBe(201);
  await page.reload();
  await page.locator(".paper-row", { hasText: "Ohne Foto" }).click();
  await expect(sheet(page).locator('[data-field="body"]')).toHaveValue("# nur Text");
  await expect(sheet(page).getByTestId("note-photo")).toHaveCount(0);
});

test("a short note with no body is typed in place, and its details sheet is the entry sheet", async ({ page }) => {
  const day = localDay();
  expect((await page.request.post(`${app.baseUrl}/api/entries`, { data: { date: day, type: "note", title: "Kurze Notiz" } })).status()).toBe(201);
  await page.goto(app.baseUrl);
  await page.locator(".paper-row", { hasText: "Kurze Notiz" }).click();
  await expect(page.locator(".paper-line input")).toHaveValue("Kurze Notiz");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.locator(".inline-bar [data-action=details]").click();
  await expect(page.getByRole("heading", { name: "Edit entry" })).toBeVisible();
  await expect(page.getByTestId("sync-line")).toHaveCount(0);
  await expect(sheet(page)).toHaveCount(0);
});
