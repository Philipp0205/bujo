import { expect, test, type Page } from "@playwright/test";
import { pinClock, pinnedDay, useBujo } from "./harness.ts";

const app = useBujo();

test.beforeEach(async ({ page }) => {
  await pinClock(page);
  await app.signIn(page);
  await page.addInitScript(() => sessionStorage.setItem("ak-install-prompt-dismissed", "1"));
  await clearLog(page);
});

/** Today as YYYY-MM-DD in the local time zone (the page uses the local day too). */
const today = () => pinnedDay(0);

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

test("rows, nested rows and their tags carry no ink svg and no box, while the Today mark keeps its pen underline", async ({ page }) => {
  await seedNested(page);
  await page.goto(app.baseUrl);
  await expect(card(page, "Zahnarzt")).toBeVisible();

  await expect(page.locator(".entry-card")).toHaveCount(2);
  const child = card(page, "Zahnarzt").locator(".card-child");
  await expect(child).toHaveCount(1);
  await expect(child).toContainText("Rechnung prüfen");
  await expect(page.locator(".entry-card svg.ink-stroke")).toHaveCount(0);

  await expect(card(page, "Zahnarzt").locator(".paper-row[data-indent='0'] .pill")).toHaveText(["health", "14:30"]);
  await expect(page.locator(".paper-meta .pill")).toHaveCount(5);
  await expect(page.locator("[data-testid=today-mark] > svg.ink-stroke")).toHaveCount(1);
  await expect(page.locator("[data-testid=today-mark]")).toHaveText("Today");

  // No outline of any kind is left on a row, a nested row or a tag. A tag keeps the soft paper wash behind its word, which is no outline.
  for (const selector of [".entry-card", ".card-child", ".paper-row", ".paper-meta .pill"]) {
    const style = await page.locator(selector).first().evaluate((el) => {
      const css = getComputedStyle(el);
      return { border: css.borderTopWidth, radius: css.borderTopLeftRadius, outline: css.outlineStyle };
    });
    expect(style).toEqual({ border: "0px", radius: "0px", outline: "none" });
  }
  for (const selector of [".entry-card", ".card-child", ".paper-row"]) {
    const style = await page.locator(selector).first().evaluate((el) => {
      const css = getComputedStyle(el);
      return { shadow: css.boxShadow, bg: css.backgroundColor };
    });
    expect(style).toEqual({ shadow: "none", bg: "rgba(0, 0, 0, 0)" });
  }
});

test("a tag is written in its own pen colour, time in ochre, and the Today underline in the today colour", async ({ page }) => {
  await seedNested(page);
  await page.goto(app.baseUrl);
  await expect(card(page, "Zahnarzt")).toBeVisible();

  const colour = (selector: string) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).color);
  const tag = await colour(".pill-tag");
  const time = await colour(".pill-time");
  expect(tag).not.toBe(time);
  expect(await page.locator(".pill-time").first().evaluate((el) => el.getAttribute("data-hue"))).toBe("ochre");
  expect(await page.locator(".pill-tag").first().evaluate((el) => el.getAttribute("data-hue"))).toMatch(/^(sage|sky|leaf|clay|brick)$/);
  expect(await colour("[data-testid=today-mark] > svg.ink-stroke")).toBe(await colour("[data-testid=today-mark]"));
});

test("the Today underline wobble is stable: a reload gives the same stroke", async ({ page }) => {
  await seedNested(page);
  await page.goto(app.baseUrl);
  await expect(card(page, "Zahnarzt")).toBeVisible();
  const before = await strokeD(page, "[data-testid=today-mark] > svg.ink-stroke path");
  expect(before).toMatch(/^M/);

  await page.reload();
  await expect(card(page, "Mittagessen")).toBeVisible();
  expect(await strokeD(page, "[data-testid=today-mark] > svg.ink-stroke path")).toBe(before);
  await expect(page.locator("[data-testid=today-mark] > svg.ink-stroke")).toHaveCount(1);
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
