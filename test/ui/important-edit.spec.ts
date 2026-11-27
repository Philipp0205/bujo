import { expect, test, type Page } from "@playwright/test";
import { line } from "../fake-ocr.ts";
import { openDetails, useBujo, WHATS_NEW_NEWEST } from "./harness.ts";
import { openScan } from "./scan-helpers.ts";

const app = useBujo();

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
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

function today(): string {
  const date = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The OCR header line for today, as it is written on the page: dd.mm.yyyy. */
const header = () => { const iso = today(); return line("none", `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`, 0.9); };

/** A fake entry through the API with the page's session. Never a real list. */
async function seed(page: Page, title: string, important: boolean): Promise<string> {
  const response = await page.request.post(`${app.baseUrl}/api/entries`, { data: { date: today(), type: "task", title, important } });
  expect(response.status()).toBe(201);
  return (await response.json()).entry.id;
}

async function importantOf(page: Page, title: string): Promise<boolean | undefined> {
  const response = await page.request.get(`${app.baseUrl}/api/entries?from=${today()}&to=${today()}`);
  return ((await response.json()).entries as Array<{ title: string; important: boolean }>).find((entry) => entry.title === title)?.important;
}

const logRow = (page: Page, title: string) => page.locator(".paper-row", { hasText: title });
const review = (page: Page) => page.getByTestId("scan-review");

async function openLog(page: Page): Promise<void> {
  await page.goto(app.baseUrl);
  await expect(page.getByRole("heading", { name: "Daily Log", level: 1 })).toBeVisible();
  await page.waitForFunction(() => !!document.querySelector(".paper-add"));
}

test("the details sheet turns important on, shows the * in the margin, then turns it off again", async ({ page }) => {
  await seed(page, "Blatt Eins", false);
  await openLog(page);

  await openDetails(page, "Blatt Eins");
  const sheetToggle = page.getByTestId("sheet-important");
  await expect(sheetToggle).toHaveAttribute("aria-pressed", "false");
  await sheetToggle.click();
  await expect(sheetToggle).toHaveAttribute("aria-pressed", "true");
  await page.locator("[data-action=save]").click();
  await expect(logRow(page, "Blatt Eins").getByTestId("important-star")).toBeVisible();
  await expect.poll(() => importantOf(page, "Blatt Eins")).toBe(true);

  await openDetails(page, "Blatt Eins");
  await expect(page.getByTestId("sheet-important")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("sheet-important").click();
  await page.locator("[data-action=save]").click();
  await expect(logRow(page, "Blatt Eins").getByTestId("important-star")).toHaveCount(0);
  await expect.poll(() => importantOf(page, "Blatt Eins")).toBe(false);
});

test("a save from the details sheet that leaves the marker alone keeps it", async ({ page }) => {
  await seed(page, "Bleibt wichtig", true);
  await openLog(page);
  await openDetails(page, "Bleibt wichtig");
  await page.locator("input[name=title]").fill("Bleibt wichtig 2");
  await page.locator("[data-action=save]").click();
  await expect(logRow(page, "Bleibt wichtig 2").getByTestId("important-star")).toBeVisible();
  expect(await importantOf(page, "Bleibt wichtig 2")).toBe(true);
});

test("scan review: no important control, the page's * still shows and saves, and a matched important entry stays important", async ({ page }) => {
  await seed(page, "Bleibt", true);
  await seed(page, "Wird erledigt", true);
  app.ocr.setLines([header(), line("•", "Bleibt"), line("x", "Wird erledigt"), line("•", "* Neu wichtig"), line("•", "Neu normal")]);
  await page.goto(app.baseUrl);
  await (await openScan(page)).setFiles(photo);
  await expect(review(page)).toBeVisible();

  const rows = review(page).locator(".scan-row");
  await expect(rows).toHaveCount(4);
  await expect(review(page).getByTestId("scan-important")).toHaveCount(0);
  await expect(review(page).locator(".scan-important")).toHaveCount(0);
  const starOf = (n: number) => rows.nth(n).getByTestId("scan-star");
  await expect(starOf(2)).toBeVisible();
  await expect(starOf(3)).toBeHidden();

  await review(page).locator("[data-action=apply]").click();
  await expect(review(page)).toBeHidden();
  await expect.poll(() => importantOf(page, "Neu wichtig")).toBe(true);
  expect(await importantOf(page, "Neu normal")).toBe(false);
  expect(await importantOf(page, "Bleibt")).toBe(true);
  expect(await importantOf(page, "Wird erledigt")).toBe(true);
});

for (const scheme of ["light", "dark"] as const) {
  test(`scan review: a matched line's note is in its sage pen color, not muted (${scheme})`, async ({ page }) => {
    await seed(page, "Schon da", false);
    await page.emulateMedia({ colorScheme: scheme });
    app.ocr.setLines([header(), line("•", "Schon da"), line("•", "Ganz neu")]);
    await page.goto(app.baseUrl);
    await (await openScan(page)).setFiles(photo);
    await expect(review(page)).toBeVisible();

    const note = review(page).locator(".scan-row[data-match=matched] .scan-note");
    await expect(note).toBeVisible();
    const colors = await note.evaluate((el) => {
      const probe = (token: string) => {
        const span = document.createElement("span");
        span.style.color = `var(${token})`;
        el.parentElement!.append(span);
        const value = getComputedStyle(span).color;
        span.remove();
        return value;
      };
      return { own: getComputedStyle(el).color, pen: probe("--mark-matched"), muted: probe("--paper-muted") };
    });
    expect(colors.own).toBe(colors.pen);
    expect(colors.own).not.toBe(colors.muted);
  });
}
