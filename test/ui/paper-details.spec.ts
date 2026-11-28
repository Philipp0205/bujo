import { expect, test, type Page } from "@playwright/test";
import { useBujo, WHATS_NEW_NEWEST } from "./harness.ts";

const app = useBujo();
const KEY = "bujo-feedback";

test.beforeEach(async ({ page }) => {
  await app.signIn(page);
  await page.addInitScript(() => sessionStorage.setItem("ak-install-prompt-dismissed", "1"));
  await page.request.put(`${app.baseUrl}/api/whats-new/seen`, { data: { id: WHATS_NEW_NEWEST } });
  // Counts every vibrate call. The stub stands in for the device.
  await page.addInitScript(() => {
    const calls: number[] = [];
    (window as unknown as { __vib: number[] }).__vib = calls;
    navigator.vibrate = (ms) => (calls.push(Number(ms)), true);
  });
});

const made: string[] = [];

test.afterEach(async ({ page }) => {
  for (const id of made.splice(0)) await page.request.delete(`${app.baseUrl}/api/entries/${id}`);
});

function today(): string {
  const date = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** A fake entry through the API with the page's session. Never a real list. */
async function seed(page: Page, entry: Record<string, unknown>): Promise<void> {
  const response = await page.request.post(`${app.baseUrl}/api/entries`, { data: { date: today(), type: "task", ...entry } });
  expect(response.status()).toBe(201);
  made.push((await response.json()).entry.id);
}

const row = (page: Page, title: string) => page.locator(".paper-row", { hasText: title });
const vibrations = (page: Page) => page.evaluate(() => (window as unknown as { __vib: number[] }).__vib.length);

async function openLog(page: Page): Promise<void> {
  await page.goto(app.baseUrl);
  await expect(page.getByRole("heading", { name: "Daily Log", level: 1 })).toBeVisible();
  await page.waitForFunction(() => !!document.querySelector(".paper-add"));
}

const toggle = (page: Page) => page.getByTestId("feel-switch");

test("the settings switch is a real switch, 44px tall, that toggles and persists", async ({ page }) => {
  await page.goto(`${app.baseUrl}/settings`);
  await expect(toggle(page)).toHaveAttribute("role", "switch");
  await expect(toggle(page)).toHaveAttribute("aria-checked", "false");
  const box = (await toggle(page).boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.width).toBeGreaterThanOrEqual(44);
  await expect(page.locator("[data-card=feel] .bj-note")).toContainText("Off by default");

  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute("aria-checked", "true");
  expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe("on");
  await page.reload();
  await expect(toggle(page)).toHaveAttribute("aria-checked", "true");

  await toggle(page).focus();
  await page.keyboard.press("Space");
  await expect(toggle(page)).toHaveAttribute("aria-checked", "false");
  await page.keyboard.press("Enter");
  await expect(toggle(page)).toHaveAttribute("aria-checked", "true");
});

test("with the switch off, checking a task off never vibrates", async ({ page }) => {
  await seed(page, { title: "Leise" });
  await openLog(page);
  await row(page, "Leise").getByTestId("toggle-done").click();
  await expect(row(page, "Leise").locator(".ink-bullet")).toHaveAttribute("data-glyph", "done");
  expect(await vibrations(page)).toBe(0);
});

test("with the switch on, each check-off vibrates once, briefly", async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem(key, "on"), KEY);
  await seed(page, { title: "Eins" });
  await seed(page, { title: "Zwei" });
  await openLog(page);
  await row(page, "Eins").getByTestId("toggle-done").click();
  await expect(row(page, "Eins").locator(".ink-bullet")).toHaveAttribute("data-glyph", "done");
  expect(await vibrations(page)).toBe(1);
  await row(page, "Zwei").getByTestId("toggle-done").click();
  await expect(row(page, "Zwei").locator(".ink-bullet")).toHaveAttribute("data-glyph", "done");
  expect(await vibrations(page)).toBe(2);
  const first = await page.evaluate(() => (window as unknown as { __vib: number[] }).__vib[0]);
  expect(first).toBeGreaterThanOrEqual(8);
  expect(first).toBeLessThanOrEqual(12);
});

/** Parses "rgb(r, g, b)" into numbers. */
const parse = (css: string) => css.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number);
const lum = ([r, g, b]: number[]) => {
  const [x, y, z] = [r, g, b].map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * x + 0.7152 * y + 0.0722 * z;
};

test("secondary text is pencil gray and readable on the paper", async ({ page }, info) => {
  await seed(page, { title: "Bleistift" });
  await openLog(page);
  const colours = await page.locator(".paper-day").first().evaluate((el) => {
    const probe = document.createElement("i");
    probe.style.color = getComputedStyle(document.documentElement).getPropertyValue("--pencil");
    document.body.appendChild(probe);
    const pencil = getComputedStyle(probe).color;
    probe.remove();
    return { text: getComputedStyle(el).color, pencil, paper: getComputedStyle(document.body).backgroundColor };
  });
  expect(colours.text).toBe(colours.pencil);
  const [hi, lo] = [lum(parse(colours.text)), lum(parse(colours.paper))].sort((a, b) => b - a);
  expect((hi + 0.05) / (lo + 0.05)).toBeGreaterThanOrEqual(4.5);
  expect(info.project.name).toMatch(/phone-(light|dark)/);
});

test("the handwritten words get a stable tilt and lift, and rows keep their height", async ({ page }) => {
  await seed(page, { title: "Brot kaufen", tags: ["haushalt"], time: "09:00" });
  await seed(page, { title: "Zahnarzt", tags: ["gesundheit"] });
  await openLog(page);
  const read = () => page.locator(".paper-row").evaluateAll((rows) => rows.map((el) => ({
    id: el.getAttribute("data-id"),
    rot: (el as HTMLElement).style.getPropertyValue("--jit-rot"),
    y: (el as HTMLElement).style.getPropertyValue("--jit-y"),
    height: el.getBoundingClientRect().height,
  })));
  const before = await read();
  expect(before.length).toBeGreaterThanOrEqual(2);
  for (const item of before) {
    expect(Math.abs(parseFloat(item.rot))).toBeLessThanOrEqual(0.6);
    expect(Math.abs(parseFloat(item.y))).toBeLessThanOrEqual(0.8);
  }
  expect(new Set(before.map((item) => `${item.rot}/${item.y}`)).size).toBeGreaterThan(1);
  const transform = await row(page, "Brot kaufen").locator(".pill-tag").evaluate((el) => getComputedStyle(el).transform);
  expect(transform).not.toBe("none");

  await page.reload();
  await page.waitForFunction(() => !!document.querySelector(".paper-row[data-jit]"));
  const after = await read();
  expect(after).toEqual(before);

  // Without the tilt and the inline-block words the rows are the same height.
  await page.addStyleTag({ content: ".paper-meta .pill { display: inline !important; transform: none !important; }" });
  const plain = await read();
  expect(plain.map((item) => item.height)).toEqual(before.map((item) => item.height));
  for (const item of before) expect(item.height % 24).toBe(0);
});

test("the dropped bullet is a dot with a slash, drawn as two strokes", async ({ page }) => {
  await seed(page, { type: "dropped", title: "Verworfen" });
  await openLog(page);
  const svg = row(page, "Verworfen").locator(".paper-sym svg.ink-bullet");
  await expect(svg).toHaveAttribute("data-glyph", "dropped");
  await expect(svg.locator("path")).toHaveCount(2);
});
