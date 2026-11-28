import { expect, test, type Page } from "@playwright/test";
import { line } from "../fake-ocr.ts";
import { useBujo } from "./harness.ts";
import { openScan } from "./scan-helpers.ts";

const app = useBujo();

// A 1x1 PNG. The fake OCR service ignores the pixels and answers the lines the test sets.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
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

const review = (page: Page) => page.getByTestId("scan-review");
const keep = (page: Page, at: number) => review(page).locator(".scan-row").nth(at).locator('[data-field="include"]');

/** Opens a review of two new lines in the given scheme. */
async function openReview(page: Page, scheme: "light" | "dark"): Promise<void> {
  await page.emulateMedia({ colorScheme: scheme });
  const day = today();
  const header = line("none", `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`, 0.9);
  app.ocr.setLines([header, line("•", "Post abholen", 0.9), line("•", "Brief schreiben", 0.9)]);
  await page.goto(app.baseUrl);
  await (await openScan(page)).setFiles(photo);
  await expect(review(page)).toBeVisible();
}

for (const scheme of ["light", "dark"] as const) {
  test(`the grain is a static layer that never takes a tap, in ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(app.baseUrl);
    const grain = await page.evaluate(() => {
      const style = getComputedStyle(document.body, "::before");
      return { events: style.pointerEvents, position: style.position, image: style.backgroundImage, opacity: Number(style.opacity), content: style.content };
    });
    expect(grain.content).not.toBe("none");
    expect(grain.events).toBe("none");
    expect(grain.position).toBe("fixed");
    expect(grain.image).toContain("data:image/svg+xml");
    expect(grain.opacity).toBeGreaterThan(0);
    expect(grain.opacity).toBeLessThanOrEqual(scheme === "dark" ? 0.1 : 0.2);
    // A tap goes through it to the page.
    const top = await page.evaluate(() => document.elementFromPoint(100, 100)?.tagName);
    expect(top).not.toBe("BODY");
  });

  test(`the log page has a margin line that scrolls with it, in ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(app.baseUrl);
    const layers = await page.locator("#log.paper").evaluate((node) => getComputedStyle(node).backgroundImage.match(/gradient/g)?.length ?? 0);
    expect(layers).toBe(2);
    expect(await page.locator("#log.paper").evaluate((node) => getComputedStyle(node).backgroundAttachment)).toBe("local, local");
  });

  test(`the Apply button is a pen-drawn ink button with the same name, a 44px hit area and a drawing that survives a label change, in ${scheme}`, async ({ page }) => {
    await openReview(page, scheme);
    const apply = review(page).getByRole("button", { name: /^Apply/ });
    await expect(apply).toHaveAttribute("data-action", "apply");
    await expect(apply).toHaveAttribute("data-ink", "drawn");
    expect((await apply.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const mask = () => apply.evaluate((node) => getComputedStyle(node, "::before").maskImage || getComputedStyle(node, "::before").webkitMaskImage);
    expect(await mask()).toContain("data:image/svg+xml");
    expect(await apply.evaluate((node) => getComputedStyle(node).backgroundColor)).not.toBe("rgb(23, 19, 15)");
    const label = await apply.textContent();
    await keep(page, 1).click();
    await expect(apply).not.toHaveText(label!);
    expect(await mask()).toContain("data:image/svg+xml");
    await expect(apply).toBeEnabled();
  });

  test(`the Keep box is a hand-drawn tick box that toggles by click and by keyboard and keeps its checkbox semantics, in ${scheme}`, async ({ page }) => {
    await openReview(page, scheme);
    const box = keep(page, 0);
    await expect(box).toHaveRole("checkbox");
    await expect(box).toHaveAccessibleName("Keep this line");
    await expect(box).toHaveAttribute("aria-checked", "true");
    const size = (await box.boundingBox())!;
    expect(Math.min(size.width, size.height)).toBeGreaterThanOrEqual(44);
    const tick = box.locator(".ink-tick-mark").first();
    const shown = () => tick.evaluate((node) => getComputedStyle(node).visibility);
    expect(await shown()).toBe("visible");
    await expect(box.locator(".ink-tick svg")).toHaveCount(1);

    await box.click();
    await expect(box).toHaveAttribute("aria-checked", "false");
    expect(await shown()).toBe("hidden");
    await box.focus();
    await page.keyboard.press("Enter");
    await expect(box).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Space");
    await expect(box).toHaveAttribute("aria-checked", "false");
    await page.keyboard.press("Space");
    await expect(box).toHaveAttribute("aria-checked", "true");
    expect(await shown()).toBe("visible");
  });
}
