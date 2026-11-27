import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { line } from "../fake-ocr.ts";
import { useBujo, WHATS_NEW_NEWEST } from "./harness.ts";
import { openGallery } from "./scan-helpers.ts";

const app = useBujo();

// A 1x1 PNG for the gallery (the fake OCR ignores the pixels). Never a real page photo.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const files = (count: number) => Array.from({ length: count }, (_, index) => ({ name: `page-${index + 1}.png`, mimeType: "image/png", buffer: PNG }));

test.beforeEach(async ({ page }) => {
  await app.signIn(page);
  await page.addInitScript(() => sessionStorage.setItem("ak-install-prompt-dismissed", "1"));
  await page.request.put(`${app.baseUrl}/api/whats-new/seen`, { data: { id: WHATS_NEW_NEWEST } });
  app.ocr.failWith(0);
  app.ocr.delay(0);
  app.ocr.setPage(null);
});

/** The pages of the active notebook as the detail lists them, with the photos kept for each. */
async function detailPages(page: Page): Promise<Array<{ ref: string; number: number; photos: Array<{ id: string }> }>> {
  const list = (await (await page.request.get(`${app.baseUrl}/api/notebooks`)).json()).notebooks as Array<{ id: string; active: boolean }>;
  const id = list.find((notebook) => notebook.active)!.id;
  return (await (await page.request.get(`${app.baseUrl}/api/notebooks/${id}`)).json()).pages;
}

test("each log page of a batch keeps its own photo for its own paper page", async ({ page }) => {
  const answer = (number: number, day: string) => ({ lines: [line("none", `${day}.11.2026`), line("•", `Line of page ${number}`)], pageNumber: number });
  app.ocr.script([answer(5, "18"), answer(6, "19")]);
  await page.goto(app.baseUrl);
  await (await openGallery(page)).setFiles(files(2));
  const uploads: string[] = [];
  page.on("response", (response) => {
    if (response.url().includes("/api/page-photos") && response.request().method() === "POST") uploads.push(response.url());
  });
  for (const number of [5, 6]) {
    await expect(page.getByTestId("scan-paper-number")).toHaveValue(String(number));
    await page.getByTestId("scan-review").locator("[data-action=apply]").click();
    await expect.poll(() => uploads.length).toBe(number - 4);
  }
  expect(uploads[0]).toContain("ref=2026-11-18");
  expect(uploads[1]).toContain("ref=2026-11-19");

  const pages = await detailPages(page);
  const first = pages.find((entry) => entry.ref === "2026-11-18")!;
  const second = pages.find((entry) => entry.ref === "2026-11-19")!;
  expect([first.number, second.number]).toEqual([5, 6]);
  expect(first.photos).toHaveLength(1);
  expect(second.photos).toHaveLength(1);
  expect(first.photos[0].id).not.toBe(second.photos[0].id);
  const stored = fs.readdirSync(app.photoDir);
  expect(stored).toContain(`${first.photos[0].id}.jpg`);
  expect(stored).toContain(`${second.photos[0].id}.jpg`);
});

test("a retried page uploads its own photo when it is applied", async ({ page }) => {
  app.ocr.script([{ lines: [line("none", "20.11.2026"), line("•", "Line of page 7")], pageNumber: 7 }, { status: 500 }]);
  await page.goto(app.baseUrl);
  await (await openGallery(page)).setFiles(files(2));
  await expect(page.getByTestId("scan-page-of")).toHaveText("Page 1 of 2");
  await page.locator("[data-action=skip-page]").click();
  await expect(page.getByTestId("scan-page-status")).toBeVisible();
  app.ocr.setLines([line("none", "21.11.2026"), line("•", "Line of page 8")]);
  app.ocr.setPageNumber(8);
  await page.locator("[data-action=retry]").click();
  await expect(page.getByTestId("scan-paper-number")).toHaveValue("8");
  const uploaded = page.waitForResponse((response) => response.url().includes("/api/page-photos") && response.request().method() === "POST");
  await page.getByTestId("scan-review").locator("[data-action=apply]").click();
  expect((await uploaded).url()).toContain("ref=2026-11-21");
});
