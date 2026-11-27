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
const ORDER = ["Semmeln kaufen", "Idee Urlaub", "Post abholen", "Brief schreiben"];
const row = (page: Page, title: string) => review(page).locator(".scan-row").nth(ORDER.indexOf(title));

/** Opens a review with one line per state: updated with a type change, matched, new, and a new line the person skips. */
async function openMarkedReview(page: Page, scheme: "light" | "dark"): Promise<void> {
  await page.emulateMedia({ colorScheme: scheme });
  const day = today();
  for (const entry of [{ type: "task", title: "Semmeln kaufen" }, { type: "note", title: "Idee Urlaub" }]) {
    expect((await page.request.post(`${app.baseUrl}/api/entries`, { data: { date: day, ...entry } })).status()).toBe(201);
  }
  const header = line("none", `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`, 0.9);
  app.ocr.setLines([header, line("x", "Semmeln kaufen", 0.92), line("–", "Idee Urlaub", 0.9), line("•", "Post abholen", 0.9), line("•", "Brief schreiben", 0.9)]);
  await page.goto(app.baseUrl);
  await (await openScan(page)).setFiles(photo);
  await expect(review(page)).toBeVisible();
  await row(page, "Brief schreiben").locator('[data-field="include"]').click();
}

for (const scheme of ["light", "dark"] as const) {
  test(`the review marks each line as matched, new, updated or skipped, in ${scheme}`, async ({ page }) => {
    await openMarkedReview(page, scheme);
    const expected = [
      ["Semmeln kaufen", "updated", "Updated, will change the entry, type changes"],
      ["Idee Urlaub", "matched", "Matched, unchanged on paper"],
      ["Post abholen", "new", "New, will create an entry"],
      ["Brief schreiben", "skipped", "Skipped, will not be applied"],
    ];
    for (const [title, state, label] of expected) {
      const marked = row(page, title);
      await expect(marked).toHaveAttribute("data-marker", state);
      await expect(marked.getByTestId("scan-pill")).toHaveClass(new RegExp(`scan-pill-${state}`));
      await expect(marked.getByTestId("scan-pill")).toHaveAccessibleName(label);
    }

    // Every state has its own outline color, and a skipped line has a dashed outline besides.
    const outline = async (title: string) => row(page, title).getByTestId("scan-pill").evaluate((node) => {
      const style = getComputedStyle(node);
      return { color: style.borderTopColor, style: style.borderTopStyle };
    });
    const looks = await Promise.all(expected.map(([title]) => outline(title)));
    expect(new Set(looks.map((look) => look.color)).size).toBe(4);
    expect(looks.map((look) => look.style)).toEqual(["solid", "solid", "solid", "dashed"]);
  });

  test(`a changed type draws the bullet as a dot in a circle, and the legend names every state, in ${scheme}`, async ({ page }) => {
    await openMarkedReview(page, scheme);
    const circled = await row(page, "Semmeln kaufen").locator(".scan-glyph").evaluate((node) => getComputedStyle(node, "::after").borderTopStyle);
    expect(circled).toBe("solid");
    await expect(row(page, "Semmeln kaufen")).toHaveAttribute("data-type-changed", "true");
    for (const title of ["Idee Urlaub", "Post abholen", "Brief schreiben"]) {
      await expect(row(page, title)).toHaveAttribute("data-type-changed", "false");
      expect(await row(page, title).locator(".scan-glyph").evaluate((node) => getComputedStyle(node, "::after").content)).not.toBe('""');
    }

    const legend = review(page).getByTestId("scan-legend");
    await expect(legend).toBeVisible();
    await expect(legend.locator("li")).toHaveText(["Matched", "New", "Updated", "Skipped", "Type changed"]);
  });
}

test("the review has no tag field and no nest switch", async ({ page }) => {
  await openMarkedReview(page, "light");
  await expect(review(page).locator('[data-field="tag"]')).toHaveCount(0);
  await expect(review(page).locator('[data-field="nest"]')).toHaveCount(0);
  await expect(review(page).getByText(/Nest under line above|Nested under line above/)).toHaveCount(0);
});
