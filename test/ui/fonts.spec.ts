import { expect, test, type Page } from "@playwright/test";
import { useBujo } from "./harness.ts";

const app = useBujo();

test.beforeEach(async ({ page }) => {
  await app.signIn(page);
  await page.addInitScript(() => sessionStorage.setItem("ak-install-prompt-dismissed", "1"));
  await page.request.put(`${app.baseUrl}/api/whats-new/seen`, { data: { id: "2026-11-23-fonts" } });
});

const FACES = {
  newsreader: "Newsreader",
  literata: "Literata",
  "source-serif": "Source Serif 4",
  lora: "Lora",
} as const;

const htmlFont = (page: Page) => page.evaluate(() => document.documentElement.getAttribute("data-font"));
const textFamily = (page: Page) => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--font-text"));

/** Today's date as YYYY-MM-DD in the local time zone. */
function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

test("settings lists the four faces, each set in its own face, and Newsreader is chosen by default", async ({ page }) => {
  await page.goto(`${app.baseUrl}/settings`);
  const group = page.getByRole("group", { name: "Paper font" });
  await expect(group.getByRole("button")).toHaveCount(4);
  await expect(group.locator("[data-font=newsreader]")).toHaveAttribute("aria-pressed", "true");
  for (const [id, family] of Object.entries(FACES)) {
    const own = await group.locator(`[data-font=${id}]`).evaluate((el) => getComputedStyle(el).fontFamily);
    expect(own).toContain(family);
  }
  expect(await htmlFont(page)).toBeNull();
});

test("each choice applies its face at once and survives a reload and another page", async ({ page }) => {
  await page.goto(`${app.baseUrl}/settings`);
  for (const [id, family] of Object.entries(FACES)) {
    await page.locator(`.bj-font-opt[data-font=${id}]`).click();
    await expect(page.locator(`.bj-font-opt[data-font=${id}]`)).toHaveAttribute("aria-pressed", "true");
    expect(await textFamily(page)).toContain(family);
    await page.reload();
    await expect(page.locator(`.bj-font-opt[data-font=${id}]`)).toHaveAttribute("aria-pressed", "true");
    expect(await textFamily(page)).toContain(family);
  }
  await page.goto(app.baseUrl);
  await expect(page.locator(".paper-page")).toBeVisible();
  expect(await htmlFont(page)).toBe("lora");
});

test("the choice is set before the first paint and is never sent to the server", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("bujo-font", "literata"));
  const sent: string[] = [];
  page.on("request", (request) => { if (request.method() !== "GET") sent.push(request.postData() ?? ""); });
  await page.addInitScript(() => {
    document.addEventListener("readystatechange", () => {
      if (!(window as unknown as { __font?: string }).__font) (window as unknown as { __font: string }).__font = document.documentElement.getAttribute("data-font") ?? "";
    });
  });
  await page.goto(`${app.baseUrl}/settings`);
  expect(await page.evaluate(() => (window as unknown as { __font: string }).__font)).toBe("literata");
  await page.locator(".bj-font-opt[data-font=lora]").click();
  expect(sent.join("")).not.toContain("lora");
});

test("a bad saved value falls back to Newsreader", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("bujo-font", "comic"));
  await page.goto(`${app.baseUrl}/settings`);
  expect(await htmlFont(page)).toBeNull();
  await expect(page.locator(".bj-font-opt[data-font=newsreader]")).toHaveAttribute("aria-pressed", "true");
});

test("the journal text is a step heavier than 400 in every face, and the log uses the chosen face", async ({ page }) => {
  const response = await page.request.post(`${app.baseUrl}/api/entries`, { data: { date: today(), type: "note", title: "Gewicht pruefen" } });
  expect(response.status()).toBe(201);
  for (const [id, family] of Object.entries(FACES)) {
    await page.addInitScript((value) => localStorage.setItem("bujo-font", value), id);
    await page.goto(app.baseUrl);
    const title = page.locator(".paper-row", { hasText: "Gewicht pruefen" }).locator(".paper-title");
    await expect(title).toBeVisible();
    const style = await title.evaluate((el) => {
      const s = getComputedStyle(el);
      return { family: s.fontFamily, variation: s.fontVariationSettings };
    });
    expect(style.family).toContain(family);
    const weight = Number(/"wght" ([\d.]+)/.exec(style.variation)?.[1]);
    expect(weight).toBeGreaterThan(400);
    expect(weight).toBeLessThan(600);
  }
});
