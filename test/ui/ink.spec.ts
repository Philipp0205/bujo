import { expect, test, type Page } from "@playwright/test";
import { useBujo } from "./harness.ts";

const app = useBujo();

test.beforeEach(async ({ page }) => {
  await app.signIn(page);
  await page.addInitScript(() => sessionStorage.setItem("ak-install-prompt-dismissed", "1"));
  await clearLog(page);
});

/** Today as YYYY-MM-DD in the local time zone (the page uses the local day too). */
function today(): string {
  const date = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Removes today's entries from the test app's own log, so each test starts from an empty day. Local only, never Nextcloud. */
async function clearLog(page: Page): Promise<void> {
  const list = await page.request.get(`${app.baseUrl}/api/entries?from=${today()}&to=${today()}`);
  for (const entry of (await list.json()).entries as Array<{ id: string }>) {
    const gone = await page.request.delete(`${app.baseUrl}/api/entries/${entry.id}`);
    expect(gone.status()).toBe(200);
  }
}

/** Creates fake entries through the API with the page's session, then nests the one called child under the one before it. */
async function seedNested(page: Page): Promise<void> {
  const make = async (data: Record<string, unknown>) => {
    const response = await page.request.post(`${app.baseUrl}/api/entries`, { data: { date: today(), ...data } });
    expect(response.status()).toBe(201);
    return ((await response.json()) as { entry: { id: string } }).entry;
  };
  await make({ type: "task", title: "Zahnarzt anrufen", tags: ["health"], time: "14:30" });
  const child = await make({ type: "task", title: "Rechnung prüfen" });
  await make({ type: "event", title: "Mittagessen mit Mira", tags: ["friends"], time: "12:15" });
  const patch = await page.request.patch(`${app.baseUrl}/api/entries/${child.id}`, { data: { indent: 1 } });
  expect(patch.status()).toBe(200);
}

const card = (page: Page, title: string) => page.locator(".entry-card", { hasText: title });
const strokeD = (page: Page, selector: string) => page.locator(selector).first().evaluate((el) => el.getAttribute("d"));

test("cards, nested cards, pills and the Today mark each carry an ink svg, and no soft paper chrome is left", async ({ page }) => {
  await seedNested(page);
  await page.goto(app.baseUrl);
  await expect(card(page, "Zahnarzt")).toBeVisible();

  await expect(page.locator(".entry-card")).toHaveCount(2);
  for (const title of ["Zahnarzt", "Mittagessen"]) {
    await expect(card(page, title).locator(":scope > svg.ink-stroke")).toHaveCount(1);
  }
  const child = card(page, "Zahnarzt").locator(".card-child");
  await expect(child).toHaveCount(1);
  await expect(child.locator(":scope > svg.ink-stroke")).toHaveCount(1);
  await expect(child).toContainText("Rechnung prüfen");

  await expect(card(page, "Zahnarzt").locator(".paper-row[data-indent='0'] .pill")).toHaveText(["health", "14:30"]);
  const pills = page.locator(".entry-card .pill");
  const count = await pills.count();
  expect(count).toBeGreaterThanOrEqual(5);
  await expect(page.locator(".entry-card .pill > svg.ink-stroke")).toHaveCount(count);
  await expect(page.locator("[data-testid=today-mark] > svg.ink-stroke")).toHaveCount(1);
  await expect(page.locator("[data-testid=today-mark]")).toHaveText("Today");

  // The pen is the card chrome: nothing is filled, boxed, rounded by CSS or shadowed.
  for (const selector of [".entry-card", ".card-child", ".pill"]) {
    const style = await page.locator(selector).first().evaluate((el) => {
      const css = getComputedStyle(el);
      return { bg: css.backgroundColor, shadow: css.boxShadow, border: css.borderTopWidth, radius: css.borderTopLeftRadius };
    });
    expect(style).toEqual({ bg: "rgba(0, 0, 0, 0)", shadow: "none", border: "0px", radius: "0px" });
  }
});

test("a pill is outlined in its own colour and the card in the pen colour", async ({ page }) => {
  await seedNested(page);
  await page.goto(app.baseUrl);
  await expect(card(page, "Zahnarzt")).toBeVisible();

  const colour = (selector: string) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).color);
  const tag = await colour(".pill-tag > svg.ink-stroke");
  expect(tag).toBe(await colour(".pill-tag"));
  const time = await colour(".pill-time > svg.ink-stroke");
  expect(time).toBe(await colour(".pill-time"));
  expect(tag).not.toBe(time);
  expect(await colour(".entry-card > svg.ink-stroke")).toBe(await page.evaluate(() => {
    const probe = document.createElement("i");
    probe.style.color = getComputedStyle(document.documentElement).getPropertyValue("--pen");
    document.body.appendChild(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }));
});

test("the wobble is stable: a reload gives the same strokes, and a resize redraws with the same seed", async ({ page }) => {
  await seedNested(page);
  await page.goto(app.baseUrl);
  await expect(card(page, "Zahnarzt")).toBeVisible();
  const before = await strokeD(page, ".entry-card:has-text('Mittagessen') > svg.ink-stroke path");
  expect(before).toMatch(/^M/);

  await page.reload();
  await expect(card(page, "Mittagessen")).toBeVisible();
  expect(await strokeD(page, ".entry-card:has-text('Mittagessen') > svg.ink-stroke path")).toBe(before);

  // A taller card (its title wraps in a narrower window) is drawn again, and never twice.
  await page.setViewportSize({ width: 320, height: 844 });
  await expect.poll(() => strokeD(page, ".entry-card:has-text('Mittagessen') > svg.ink-stroke path")).not.toBe(before);
  await expect(card(page, "Mittagessen").locator(":scope > svg.ink-stroke")).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => strokeD(page, ".entry-card:has-text('Mittagessen') > svg.ink-stroke path")).toBe(before);
});

test("the edit sheet is inked: a wobbly top, a handle, a rule above the bar and chips, with the bar and input still working", async ({ page }) => {
  await seedNested(page);
  await page.goto(app.baseUrl);
  await card(page, "Mittagessen").locator(".paper-row").click();

  const sheet = page.getByTestId("edit-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.locator(":scope > svg.ink-stroke")).toHaveCount(1);
  await expect(sheet.locator(".edit-handle > svg.ink-stroke")).toHaveCount(1);
  await expect(sheet.locator(".inline-bar > svg.ink-stroke")).toHaveCount(1);
  await expect(sheet.locator(".sheet-chips .pill")).toHaveText(["friends", "12:15"]);
  await expect(sheet.locator(".sheet-chips .pill > svg.ink-stroke")).toHaveCount(2);
  await expect(sheet.locator(".paper-edit-input")).toBeFocused();
  await expect(sheet.locator(".inline-bar")).toBeVisible();

  // A chip that changes is inked again, and the chips never stack strokes.
  await page.locator(".bar-key[data-key=tag]").click();
  await page.locator('.inline-pop input[name="tag"]').fill("work");
  await page.keyboard.press("Enter");
  await expect(sheet.locator(".sheet-chips .pill-tag")).toHaveText(["friends", "work"]);
  await expect(sheet.locator(".sheet-chips .pill > svg.ink-stroke")).toHaveCount(3);
  await expect(sheet.locator(".sheet-chips .pill-tag > svg.ink-stroke")).toHaveCount(2);

  // The sheet is solid and the list behind it is dimmed.
  expect(await sheet.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
  expect(await page.evaluate(() => getComputedStyle(document.documentElement, "::after").backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
});
