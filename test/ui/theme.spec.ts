import { expect, test, type Page } from "@playwright/test";
import { useBujo } from "./harness.ts";

const app = useBujo();

const PAPER = { dark: "rgb(22, 19, 15)", light: "rgb(244, 239, 228)" };

test.beforeEach(async ({ page }) => {
  await app.signIn(page);
  await page.addInitScript(() => sessionStorage.setItem("ak-install-prompt-dismissed", "1"));
});

/** Opens settings and taps one of the three theme buttons. */
async function choose(page: Page, theme: "system" | "light" | "dark"): Promise<void> {
  await page.goto(`${app.baseUrl}/settings`);
  await page.locator(`[data-theme=${theme}]`).click();
  await expect(page.locator(`[data-theme=${theme}]`)).toHaveAttribute("aria-pressed", "true");
}

const bodyBg = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const scheme = (page: Page) => page.evaluate(() => document.documentElement.getAttribute("data-ak-scheme"));

test("the picker has System, Light and Dark, and System is chosen by default", async ({ page }) => {
  await page.goto(`${app.baseUrl}/settings`);
  const group = page.getByRole("group", { name: "Theme" });
  await expect(group.getByRole("button")).toHaveText(["System", "Light", "Dark"]);
  await expect(group.locator("[data-theme=system]")).toHaveAttribute("aria-pressed", "true");
  expect(await scheme(page)).toBeNull();
});

test("a choice sticks across a reload and across pages", async ({ page }) => {
  await choose(page, "light");
  await page.reload();
  await expect(page.locator("[data-theme=light]")).toHaveAttribute("aria-pressed", "true");
  expect(await scheme(page)).toBe("light");
  await page.goto(app.baseUrl);
  await expect(page.locator(".paper-page")).toBeVisible();
  expect(await scheme(page)).toBe("light");
  await page.goto(`${app.baseUrl}/backlog`);
  expect(await scheme(page)).toBe("light");
  expect(await bodyBg(page)).toBe(PAPER.light);
});

test("System follows the OS, and changes with it", async ({ page }) => {
  await choose(page, "system");
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await bodyBg(page)).toBe(PAPER.dark);
  await page.emulateMedia({ colorScheme: "light" });
  expect(await bodyBg(page)).toBe(PAPER.light);
});

test("Light stays light while the OS is dark", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await choose(page, "light");
  expect(await scheme(page)).toBe("light");
  expect(await bodyBg(page)).toBe(PAPER.light);
  await page.goto(app.baseUrl);
  await expect(page.locator(".paper-page")).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.querySelector(".paper")!).backgroundColor)).toBe(PAPER.light);
});

test("Dark stays dark while the OS is light", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await choose(page, "dark");
  expect(await scheme(page)).toBe("dark");
  expect(await bodyBg(page)).toBe(PAPER.dark);
});

test("the browser bar colour follows a forced theme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await choose(page, "light");
  await expect.poll(() => page.evaluate(() => document.querySelector('meta[name="theme-color"]')?.getAttribute("content"))).toBe("#f4efe4");
});

test("the boot script is the first script in the head, ahead of every stylesheet", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("bujo-theme", "dark"));
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(`${app.baseUrl}/settings`);
  const order = await page.evaluate(() => {
    const boot = document.head.querySelector('script[src="/js/theme/boot.js"]')!;
    const sheet = document.head.querySelector('link[rel="stylesheet"]')!;
    return {
      first: document.head.querySelector("script")?.getAttribute("src"),
      sync: !boot.hasAttribute("async") && !boot.hasAttribute("defer"),
      before: !!(boot.compareDocumentPosition(sheet) & Node.DOCUMENT_POSITION_FOLLOWING),
    };
  });
  expect(order).toEqual({ first: "/js/theme/boot.js", sync: true, before: true });
  expect(await scheme(page)).toBe("dark");
  expect(await bodyBg(page)).toBe(PAPER.dark);
});

for (const theme of ["system", "light", "dark"] as const) {
  test(`settings shows no kit indigo, pink or pure black and white (${theme})`, async ({ page }) => {
    await choose(page, theme);
    await page.locator("#token-name").focus();
    const found = await page.evaluate(() => {
      const bad = new Set(["rgb(0, 0, 0)", "rgb(255, 255, 255)", "rgb(227, 22, 107)", "rgb(194, 24, 91)", "rgb(255, 77, 141)", "rgb(141, 153, 255)", "rgb(51, 65, 184)", "rgb(111, 124, 240)"]);
      const hits: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>("main *, body, html")) {
        const style = getComputedStyle(el);
        for (const prop of ["color", "backgroundColor", "borderTopColor", "outlineColor"] as const) {
          const hidden = prop === "borderTopColor" && style.borderTopWidth === "0px";
          if (!hidden && bad.has(style[prop]) && !(prop === "outlineColor" && style.outlineStyle === "none")) hits.push(`${el.tagName}.${el.className} ${prop} ${style[prop]}`);
        }
      }
      const root = getComputedStyle(document.documentElement);
      for (const name of ["--ak-accent", "--ak-accent-2", "--ak-accent-strong"]) {
        if (!["#f3eee1", "#17130f", "#a79e91", "#625a4f"].includes(root.getPropertyValue(name).trim())) hits.push(`${name} ${root.getPropertyValue(name)}`);
      }
      return hits;
    });
    expect(found).toEqual([]);
  });
}

test("settings cards wear a pen outline", async ({ page }) => {
  await page.goto(`${app.baseUrl}/settings`);
  const cards = page.locator(".bj-card");
  await expect(cards).toHaveCount(4);
  for (let i = 0; i < 4; i++) await expect(cards.nth(i).locator(":scope > svg.ink-stroke")).toHaveCount(1);
});
