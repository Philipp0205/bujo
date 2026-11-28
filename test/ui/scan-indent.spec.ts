import { expect, test, type Page } from "@playwright/test";
import { line } from "../fake-ocr.ts";
import { useBujo } from "./harness.ts";
import { openScan } from "./scan-helpers.ts";

const app = useBujo();

// A 1x1 PNG. The fake OCR service ignores the pixels and answers the lines the test sets.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const photo = { name: "page.png", mimeType: "image/png", buffer: PNG };

test.beforeEach(async ({ page }) => {
  await app.signIn(page);
  await page.addInitScript(() => sessionStorage.setItem("ak-install-prompt-dismissed", "1"));
  app.ocr.failWith(0);
  app.ocr.delay(0);
});

/** Today as YYYY-MM-DD in the local time zone (the page uses the local day too). */
function today(): string {
  const date = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Every entry of today goes after each test, so each starts from an empty day. */
test.afterEach(async ({ page }) => {
  const day = today();
  const { entries } = await (await page.request.get(`${app.baseUrl}/api/entries?from=${day}&to=${day}`)).json();
  for (const entry of entries) await page.request.delete(`${app.baseUrl}/api/entries/${entry.id}`);
});

const review = (page: Page) => page.getByTestId("scan-review");
const rows = (page: Page) => review(page).locator(".scan-row");
const nested = (text: string) => ({ ...line("–", text, 0.9), indent: 1 });

/** The synthetic page: a meeting with three notes written indented under it. */
const PAGE = () => [
  line("none", `${today().slice(8, 10)}.${today().slice(5, 7)}.${today().slice(0, 4)}`, 0.9),
  line("○", "Meeting with Anna", 0.9),
  nested("Note 1"),
  nested("Note 2"),
  nested("Note 3"),
];

test("a scanned meeting keeps its indented notes nested, in the review and in the daily log", async ({ page }) => {
  app.ocr.setLines(PAGE());
  await page.goto(app.baseUrl);
  await (await openScan(page)).setFiles(photo);
  await expect(review(page)).toBeVisible();

  // The review draws the three notes one step in, and has no nest switch (the paper decides the nesting).
  await expect(rows(page)).toHaveCount(4);
  expect(await rows(page).evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-indent")))).toEqual(["0", "1", "1", "1"]);
  await expect(review(page).getByTestId("scan-nest")).toHaveCount(0);
  const left = (index: number) => rows(page).nth(index).evaluate((node) => node.getBoundingClientRect().left);
  expect((await left(1)) - (await left(0))).toBe(24);
  expect(await left(2)).toBe(await left(1));

  await review(page).locator("[data-action=apply]").click();
  await expect(review(page)).toHaveCount(0);

  // The daily log shows the notes inside the meeting's card, one step in.
  const card = page.locator(".entry-card", { hasText: "Meeting with Anna" });
  await expect(card.locator(".paper-row")).toHaveText([/Meeting with Anna/, /Note 1/, /Note 2/, /Note 3/]);
  expect(await card.locator(".paper-row").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-indent")))).toEqual(["0", "1", "1", "1"]);
  const first = (await card.locator(".paper-row").nth(0).boundingBox())!;
  const child = (await card.locator(".paper-row").nth(1).boundingBox())!;
  expect(child.x - first.x).toBe(24);
});
