import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { line } from "../fake-ocr.ts";
import { openNotebook, useBujo, WHATS_NEW_NEWEST } from "./harness.ts";
import { openScan } from "./scan-helpers.ts";

const app = useBujo();

// The specs of this file build on each other: the pages and their photos only grow.
test.describe.configure({ mode: "serial" });

// A 1x1 PNG for the camera (the fake OCR ignores the pixels) and a made-up tiny JPEG for the stored photos. Never a real page photo.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64",
);
const photo = { name: "page.png", mimeType: "image/png", buffer: PNG };

test.beforeEach(async ({ page }) => {
  await app.signIn(page);
  await page.addInitScript(() => sessionStorage.setItem("ak-install-prompt-dismissed", "1"));
  await page.request.put(`${app.baseUrl}/api/whats-new/seen`, { data: { id: WHATS_NEW_NEWEST } });
  app.ocr.failWith(0);
  app.ocr.delay(0);
});

const review = (page: Page) => page.getByTestId("scan-review");
const view = (page: Page) => page.getByTestId("page-photo-view");

/** The page_photos of the active notebook as the detail lists them: { ref, photos } per page. */
async function detailPages(page: Page): Promise<Array<{ ref: string; number: number; photos: Array<{ id: string }> }>> {
  const list = (await (await page.request.get(`${app.baseUrl}/api/notebooks`)).json()).notebooks as Array<{ id: string; active: boolean }>;
  const id = list.find((notebook) => notebook.active)!.id;
  return (await (await page.request.get(`${app.baseUrl}/api/notebooks/${id}`)).json()).pages;
}

/** Files a page with this number through the API (fake OCR) and keeps `count` photos for it. */
async function seedPage(page: Page, date: string, number: number, count: number): Promise<void> {
  app.ocr.setPage(null);
  app.ocr.setLines([line("none", date.split("-").reverse().join(".")), line("•", `Line ${number}`)]);
  const scanned = await page.request.post(`${app.baseUrl}/api/log/scan`, { data: PNG, headers: { "content-type": "image/png" } });
  const draft = (await scanned.json()).draft as { id: string; items: Array<{ id: string; title: string }> };
  const items = draft.items.map((item) => ({ id: item.id, type: "task", title: item.title }));
  expect((await page.request.post(`${app.baseUrl}/api/log/scan/${draft.id}/apply`, { data: { date, paperNumber: number, items } })).status()).toBe(200);
  for (let i = 0; i < count; i += 1) {
    const stored = await page.request.post(`${app.baseUrl}/api/page-photos?kind=day&ref=${date}&page=1`, { data: Buffer.concat([JPEG, Buffer.from([i])]), headers: { "content-type": "image/jpeg" } });
    expect(stored.status()).toBe(201);
  }
}

test("applying a scan uploads the photo of the page, linked to its paper page", async ({ page }) => {
  app.ocr.setPage(null);
  app.ocr.setLines([line("none", "18.11.2026"), line("•", "Line of page 5")]);
  app.ocr.setPageNumber(5);
  await page.goto(app.baseUrl);
  await (await openScan(page)).setFiles(photo);
  await expect(review(page)).toBeVisible();
  await expect(page.getByTestId("scan-paper-number")).toHaveValue("5");
  const uploaded = page.waitForResponse((response) => response.url().includes("/api/page-photos") && response.request().method() === "POST");
  await review(page).locator("[data-action=apply]").click();
  expect((await uploaded).status()).toBe(201);
  const pages = await detailPages(page);
  const kept = pages.find((entry) => entry.ref === "2026-11-18")!;
  expect(kept.number).toBe(5);
  expect(kept.photos).toHaveLength(1);
  const served = await page.request.get(`${app.baseUrl}/api/page-photos/${kept.photos[0].id}`);
  expect(served.headers()["content-type"]).toBe("image/jpeg");
  expect((await served.body()).subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  expect(fs.readdirSync(app.photoDir)).toContain(`${kept.photos[0].id}.jpg`);
});

test("a scanned page with a photo opens the photo from the index grid, and the phone back closes it", async ({ page }) => {
  await seedPage(page, "2026-11-19", 9, 1);
  await seedPage(page, "2026-11-20", 10, 0);
  await page.goto(`${app.baseUrl}/notes`);
  await openNotebook(page);
  const withPhoto = page.getByTestId("index-cell").and(page.locator('[data-number="9"]'));
  await expect(withPhoto).toHaveAttribute("data-photo", "1");
  await withPhoto.click();
  await expect(view(page)).toBeVisible();
  await expect(page.getByTestId("page-photo-img")).toHaveAttribute("src", /\/api\/page-photos\/.+/);
  await expect(page.getByTestId("page-photo-older")).toHaveCount(0);
  await page.goBack();
  await expect(view(page)).toHaveCount(0);
  await expect(page.getByTestId("notebook-title")).toBeVisible();

  // A page with no photo still opens the page in the log.
  const without = page.getByTestId("index-cell").and(page.locator('[data-number="10"]'));
  await expect(without).toHaveAttribute("data-photo", "0");
});

test("a page row in the notebook has a thumbnail that opens the viewer, and older photos are one step away", async ({ page }) => {
  await seedPage(page, "2026-11-21", 11, 3);
  await page.goto(`${app.baseUrl}/notes`);
  await openNotebook(page);
  const thumbs = page.getByTestId("section-daily").getByTestId("page-thumb");
  const row = page.getByTestId("section-daily").getByTestId("log-row").and(page.locator('[data-ref="2026-11-21"]'));
  await expect(row).toHaveCount(1);
  const box = (await thumbs.last().boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.width).toBeLessThanOrEqual(48);

  const pages = await detailPages(page);
  const ids = pages.find((entry) => entry.ref === "2026-11-21")!.photos.map((entry) => entry.id);
  expect(ids).toHaveLength(3);
  await page.getByTestId("section-daily").locator("li", { has: page.locator('[data-ref="2026-11-21"]') }).getByTestId("page-thumb").click();
  await expect(view(page)).toBeVisible();
  const img = page.getByTestId("page-photo-img");
  await expect(img).toHaveAttribute("src", `/api/page-photos/${ids[0]}`);
  const step = page.getByTestId("page-photo-older");
  await expect(step).toHaveText("Older photos (2)");
  await step.click();
  await expect(img).toHaveAttribute("src", `/api/page-photos/${ids[1]}`);
  await expect(step).toHaveText("Older photos (1)");
  await step.click();
  await expect(img).toHaveAttribute("src", `/api/page-photos/${ids[2]}`);
  await expect(step).toHaveText("Newest photo");
  await step.click();
  await expect(img).toHaveAttribute("src", `/api/page-photos/${ids[0]}`);
  await expect(view(page)).toBeVisible();
  await page.locator('[data-action="photo-close"]').click();
  await expect(view(page)).toHaveCount(0);
});
