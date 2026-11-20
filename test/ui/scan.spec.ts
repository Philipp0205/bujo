import { expect, test } from "@playwright/test";
import { LIST_PATHS } from "../fake-caldav.ts";
import { DEFAULT_PAGE } from "../fake-ocr.ts";
import { useBujo } from "./harness.ts";

const app = useBujo();

// A 1x1 PNG. The fake OCR service ignores the pixels and answers a fixed page.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const photo = { name: "page.png", mimeType: "image/png", buffer: PNG };

test.beforeEach(async ({ page }) => {
  await app.signIn(page);
  app.ocr.failWith(0);
  app.ocr.setLines(DEFAULT_PAGE);
});

const puts = () => app.fake.requests.filter((request) => request.method === "PUT");

test("the backlog links to the scan page", async ({ page }) => {
  await page.goto(`${app.baseUrl}/backlog`);
  await page.locator('[data-nav="scan"]').click();
  await expect(page).toHaveURL(/\/scan$/);
  await expect(page.getByRole("heading", { name: "Scan", level: 1 })).toBeVisible();
});

test("pick a photo, review the lines, edit one, exclude one, set a date, accept", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(`${app.baseUrl}/scan`);

  // The camera input asks for the back camera.
  await expect(page.locator("#photo-input")).toHaveAttribute("capture", "environment");
  await expect(page.locator('[data-action="upload"]')).toHaveCount(0);
  await page.locator("#photo-pick").setInputFiles(photo);
  await expect(page.locator('[data-testid="preview"]')).toBeVisible();
  const before = puts().length;
  await page.locator('[data-action="upload"]').click();

  // Review: one card per line, the page date from the first line.
  await expect(page.locator("#app")).toHaveAttribute("data-stage", "review");
  await expect(page.locator("[data-item]")).toHaveCount(DEFAULT_PAGE.length);
  await expect(page.locator('[data-testid="page-date"]')).toContainText("20 Nov 2026");
  await expect(page.locator('[data-testid="page-date"]')).toContainText("read from the page");
  expect(puts().length).toBe(before);

  const l2 = page.locator('[data-item="l2"]');
  const l3 = page.locator('[data-item="l3"]');
  const l4 = page.locator('[data-item="l4"]');
  const l5 = page.locator('[data-item="l5"]');
  await expect(l2).toHaveAttribute("data-action", "create");
  await expect(l3).toHaveAttribute("data-action", "complete");
  await expect(l3.locator('[data-field="match"]')).toContainText("Zahnarzt anrufen");
  await expect(l4).toHaveAttribute("data-action", "keep");
  await expect(l5).toHaveAttribute("data-action", "schedule");
  await expect(page.locator('[data-item="l6"]')).toHaveAttribute("data-include", "false");
  await expect(page.locator('[data-item="l6"] [data-field="include"]')).toBeDisabled();
  await expect(page.locator('[data-item="l1"]')).toHaveAttribute("data-include", "false");

  // A scheduled line needs a date: Accept stays off and says why.
  const accept = page.locator('[data-action="accept"]');
  await expect(accept).toBeDisabled();
  await expect(page.locator('[data-testid="accept-hint"]')).toContainText("Line 5: set a due date");

  // Edit one line, exclude one, set the date.
  await l2.locator('[data-field="text"]').fill("Milch und Brot kaufen");
  await l4.locator('[data-field="include"]').uncheck();
  await expect(l4).toHaveAttribute("data-include", "false");
  await l5.locator('[data-field="due"]').fill("2026-12-24");
  await expect(accept).toBeEnabled();
  await expect(accept).toHaveText("Accept 3 items");

  // Nothing leaves the page before Accept.
  expect(puts().length).toBe(before);
  await accept.click();

  await expect(page.locator("#app")).toHaveAttribute("data-stage", "done");
  await expect(page.locator('[data-testid="result-summary"]')).toHaveText("Everything was saved.");
  await expect(page.locator("[data-result]")).toHaveCount(3);
  await expect(page.locator('[data-result="l2"]')).toContainText("Milch und Brot kaufen");
  await expect(page.locator('[data-result="l2"]')).toContainText("Saved");

  const written = puts().slice(before);
  expect(written.length).toBe(3);
  const created = written.filter((request) => request.ifNoneMatch === "*").map((request) => request.body);
  expect(created.some((body) => body.includes("SUMMARY:Milch und Brot kaufen"))).toBe(true);
  expect(created.some((body) => /DUE;VALUE=DATE:20261224/.test(body) && body.includes("SUMMARY:Müller Grüße ausrichten"))).toBe(true);
  expect(app.fake.read(LIST_PATHS.Aufgaben, "termin.ics")).toContain("STATUS:COMPLETED");
  // The excluded line and the kept task were not touched.
  expect(app.fake.read(LIST_PATHS.Aufgaben, "process.ics")).toContain("PERCENT-COMPLETE:40");
  expect(app.fake.requests.some((request) => request.method === "DELETE")).toBe(false);
  expect(errors).toEqual([]);
});

test("a bad file is refused before upload, and a failing OCR service shows an error and a way back", async ({ page }) => {
  await page.goto(`${app.baseUrl}/scan`);
  await page.locator("#photo-pick").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hi") });
  await expect(page.locator('[data-testid="scan-error"]')).toContainText("not a JPEG, PNG, WebP or HEIC");
  await expect(page.locator('[data-action="upload"]')).toHaveCount(0);

  app.ocr.failWith(500);
  await page.locator("#photo-pick").setInputFiles(photo);
  await page.locator('[data-action="upload"]').click();
  await expect(page.locator('[data-testid="scan-error"]')).toBeVisible();
  await expect(page.locator("#app")).toHaveAttribute("data-stage", "pick");
  // The photo is still chosen, so a second try needs no new pick.
  await expect(page.locator('[data-action="upload"]')).toBeVisible();
});

test("discard drops the draft without writing", async ({ page }) => {
  await page.goto(`${app.baseUrl}/scan`);
  await page.locator("#photo-pick").setInputFiles(photo);
  const before = puts().length;
  await page.locator('[data-action="upload"]').click();
  await expect(page.locator("#app")).toHaveAttribute("data-stage", "review");
  await page.locator('[data-action="discard"]').click();
  await expect(page.locator("#app")).toHaveAttribute("data-stage", "pick");
  expect(puts().length).toBe(before);
});

test("the review fits the phone width with no sideways scroll", async ({ page }) => {
  await page.goto(`${app.baseUrl}/scan`);
  await page.locator("#photo-pick").setInputFiles(photo);
  await page.locator('[data-action="upload"]').click();
  await expect(page.locator("#app")).toHaveAttribute("data-stage", "review");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
