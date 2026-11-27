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
const ORDER = ["Semmeln kaufen", "Idee Urlaub", "Post abholen", "Brief schreiben", "Termin verschieben"];
const row = (page: Page, title: string) => review(page).locator(".scan-row").nth(ORDER.indexOf(title));

/** Opens a review with one line per state: updated with a type change (x and >), matched, new, and a new line the person skips. */
async function openMarkedReview(page: Page, scheme: "light" | "dark"): Promise<void> {
  await page.emulateMedia({ colorScheme: scheme });
  const day = today();
  for (const entry of [{ type: "task", title: "Semmeln kaufen" }, { type: "note", title: "Idee Urlaub" }, { type: "task", title: "Termin verschieben" }]) {
    expect((await page.request.post(`${app.baseUrl}/api/entries`, { data: { date: day, ...entry } })).status()).toBe(201);
  }
  const header = line("none", `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`, 0.9);
  app.ocr.setLines([header, line("x", "Semmeln kaufen", 0.92), line("–", "Idee Urlaub", 0.9), line("•", "Post abholen", 0.9), line("•", "Brief schreiben", 0.9), line(">", "Termin verschieben", 0.9)]);
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

    // Every state is drawn in its own pen color, and a skipped line is drawn dashed.
    const pen = async (title: string) => row(page, title).getByTestId("scan-pill").locator("svg.scan-scribble path").first().evaluate((node) => {
      const style = getComputedStyle(node);
      return { color: style.stroke, dash: style.strokeDasharray, fill: getComputedStyle(node).fill };
    });
    const looks = await Promise.all(expected.map(([title]) => pen(title)));
    expect(new Set(looks.map((look) => look.color)).size).toBe(4);
    expect(looks.map((look) => look.dash === "none")).toEqual([true, true, true, false]);
    expect(looks.every((look) => look.fill === "none")).toBe(true);
    for (const [title] of expected) {
      const svg = row(page, title).getByTestId("scan-pill").locator("svg.scan-scribble");
      await expect(svg).toHaveAttribute("aria-hidden", "true");
      expect(await svg.evaluate((node) => getComputedStyle(node).pointerEvents)).toBe("none");
    }
  });

  test(`a changed type draws a hand-drawn ring centered on the bullet, and the legend names every state, in ${scheme}`, async ({ page }) => {
    await openMarkedReview(page, scheme);
    for (const title of ["Semmeln kaufen", "Termin verschieben"]) {
      await expect(row(page, title)).toHaveAttribute("data-type-changed", "true");
      const ring = row(page, title).locator(".scan-glyph .scan-ring");
      await expect(ring).toBeVisible();
      const centers = await row(page, title).locator(".scan-glyph").evaluate((box) => {
        const middle = (rect: DOMRect) => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
        const bullet = box.querySelector("svg:not(.scan-ring)")!.getBoundingClientRect();
        const loops = [...box.querySelectorAll(".scan-ring path")].map((path) => path.getBoundingClientRect());
        const left = Math.min(...loops.map((r) => r.left));
        const right = Math.max(...loops.map((r) => r.right));
        const top = Math.min(...loops.map((r) => r.top));
        const bottom = Math.max(...loops.map((r) => r.bottom));
        return { bullet: middle(bullet), ring: { x: (left + right) / 2, y: (top + bottom) / 2 }, drawn: loops.length };
      });
      expect(centers.drawn).toBe(2);
      expect(Math.abs(centers.ring.x - centers.bullet.x)).toBeLessThan(1.5);
      expect(Math.abs(centers.ring.y - centers.bullet.y)).toBeLessThan(1.5);
    }
    for (const title of ["Idee Urlaub", "Post abholen", "Brief schreiben"]) {
      await expect(row(page, title)).toHaveAttribute("data-type-changed", "false");
      await expect(row(page, title).locator(".scan-glyph .scan-ring")).toBeHidden();
    }

    const legend = review(page).getByTestId("scan-legend");
    await expect(legend).toBeVisible();
    await expect(legend.locator("li")).toHaveText(["Matched", "New", "Updated", "Skipped", "Type changed"]);
    await expect(legend.locator("svg.scan-scribble")).toHaveCount(4);
  });

  test(`each row has one short note under its title, in ${scheme}`, async ({ page }) => {
    await openMarkedReview(page, scheme);
    await expect(row(page, "Semmeln kaufen").locator('[data-role="note"]')).toHaveText("92% match, will be marked as done");
    await expect(row(page, "Post abholen").locator('[data-role="note"]')).toHaveText("90%");
    await expect(row(page, "Semmeln kaufen").locator(".scan-was, .scan-match, .scan-meta")).toHaveCount(0);
  });

  test(`the note is handwritten in its state color and ends in a 44px pen icon button, in ${scheme}`, async ({ page }) => {
    await openMarkedReview(page, scheme);
    const note = row(page, "Idee Urlaub").locator('[data-role="note"]');
    const style = await note.evaluate((node) => ({ font: getComputedStyle(node).fontFamily, size: getComputedStyle(node).fontSize, color: getComputedStyle(node).color }));
    expect(style.font).toContain("Caveat");
    expect(style.size).toBe("20px");
    const pen = await row(page, "Idee Urlaub").getByTestId("scan-pill").locator("svg.scan-scribble path").first().evaluate((node) => getComputedStyle(node).stroke);
    expect(style.color).toBe(pen);

    const button = row(page, "Idee Urlaub").locator('[data-field="unmatch"]');
    await expect(button).toHaveAccessibleName("Not the same");
    await expect(button.locator("svg.scan-hand-icon")).toHaveCount(1);
    const box = (await button.boundingBox())!;
    const text = (await note.boundingBox())!;
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
    expect(Math.abs(box.y + box.height / 2 - (text.y + text.height / 2))).toBeLessThan(6);
    await button.focus();
    expect(await button.evaluate((node) => getComputedStyle(node).outlineStyle)).not.toBe("none");
  });
}

test("the review has no tag field and no nest switch", async ({ page }) => {
  await openMarkedReview(page, "light");
  await expect(review(page).locator('[data-field="tag"]')).toHaveCount(0);
  await expect(review(page).locator('[data-field="nest"]')).toHaveCount(0);
  await expect(review(page).getByText(/Nest under line above|Nested under line above/)).toHaveCount(0);
});
