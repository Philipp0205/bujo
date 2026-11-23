import { expect, test, type Page } from "@playwright/test";
import { useBujo } from "./harness.ts";

const app = useBujo();

test.beforeEach(async ({ page }) => {
  await app.signIn(page);
  await page.addInitScript(() => sessionStorage.setItem("ak-install-prompt-dismissed", "1"));
  await page.request.put(`${app.baseUrl}/api/whats-new/seen`, { data: { id: "2026-11-23-fuzzy-scan-match" } });
});

/** Every test starts from an empty log: all entries of the throwaway account go. Local fake data only. */
test.afterEach(async ({ page }) => {
  const response = await page.request.get(`${app.baseUrl}/api/entries?from=${day(-20)}&to=${day(40)}`);
  for (const entry of (await response.json()).entries as Array<{ id: string }>) await page.request.delete(`${app.baseUrl}/api/entries/${entry.id}`);
});

/** A calendar day as YYYY-MM-DD in the local time zone, n days from today. */
function day(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

type Seed = { date?: string; type?: string; title: string; tags?: string[]; time?: string };

/** Fake entries through the API with the page's session. Never a real list. */
async function seed(page: Page, entries: Seed[]): Promise<void> {
  for (const entry of entries) {
    const response = await page.request.post(`${app.baseUrl}/api/entries`, { data: { date: day(0), type: "task", ...entry } });
    expect(response.status()).toBe(201);
  }
}

const row = (page: Page, title: string) => page.locator(".paper-row", { hasText: title });

test("a row has no card, border, shadow or ink stroke, and a one-line row is two grid units tall", async ({ page }) => {
  await seed(page, [{ title: "Brot kaufen", tags: ["haushalt"], time: "09:00" }, { type: "note", title: "Idee" }]);
  await page.goto(app.baseUrl);
  await expect(row(page, "Brot kaufen")).toBeVisible();

  await expect(page.locator(".entry-card > svg.ink-stroke, .card-child > svg.ink-stroke, .paper-meta svg.ink-stroke")).toHaveCount(0);
  for (const selector of [".entry-card", ".paper-row", ".paper-meta .pill"]) {
    const style = await page.locator(selector).first().evaluate((el) => {
      const css = getComputedStyle(el);
      return [css.borderTopWidth, css.borderBottomWidth, css.borderTopLeftRadius, css.outlineStyle];
    });
    expect(style).toEqual(["0px", "0px", "0px", "none"]);
  }
  for (const selector of [".entry-card", ".paper-row"]) {
    const style = await page.locator(selector).first().evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el).boxShadow]);
    expect(style).toEqual(["rgba(0, 0, 0, 0)", "none"]);
  }
  expect(await row(page, "Brot kaufen").boundingBox().then((box) => box!.height)).toBe(48);
  expect(await row(page, "Idee").boundingBox().then((box) => box!.height)).toBe(48);
  // The text of a row starts in the text column, 56px from the page edge.
  const title = (await row(page, "Idee").locator(".paper-title").boundingBox())!;
  expect(Math.round(title.x)).toBe(56);
});

test("tags and time follow a short title on its own line, handwritten, each tag in its pen colour and time in ochre", async ({ page }) => {
  await seed(page, [{ title: "Brot kaufen", tags: ["haushalt", "einkauf"], time: "09:00" }]);
  await page.goto(app.baseUrl);
  const line = row(page, "Brot kaufen");
  await expect(line.locator(".pill")).toHaveText(["haushalt", "einkauf", "09:00"]);

  const title = (await line.locator(".paper-title").boundingBox())!;
  let after = title.x + title.width - 1;
  for (const pill of await line.locator(".pill").all()) {
    const box = (await pill.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(after);
    expect(Math.abs(box.y + box.height / 2 - (title.y + title.height / 2))).toBeLessThan(10);
    after = box.x + box.width - 1;
  }

  const tag = line.locator(".pill-tag").first();
  expect(await tag.evaluate((el) => getComputedStyle(el).fontFamily)).toContain("Caveat");
  expect(await tag.evaluate((el) => getComputedStyle(el, "::before").content)).toBe('"#"');
  await expect(line.locator(".pill-time")).toHaveAttribute("data-hue", "ochre");
  const time = await line.locator(".pill-time").evaluate((el) => getComputedStyle(el).color);
  expect(time).not.toBe(await tag.evaluate((el) => getComputedStyle(el).color));
  await expect(line.locator(".pill-tag").nth(0)).toHaveAttribute("data-hue", /^(sage|sky|leaf|clay|brick)$/);
});

test("a long title wraps and its tags wrap with it, none cut off and none wider than the row", async ({ page }) => {
  const long = "Ein sehr langer Titel, der niemals auf eine Zeile passt und deshalb umbrechen muss ".repeat(2).trim();
  await seed(page, [{ type: "event", title: long, tags: ["arbeit", "besprechung", "vorbereitung"], time: "13:00" }]);
  await page.goto(app.baseUrl);
  const line = row(page, "Ein sehr langer");
  await expect(line.locator(".pill")).toHaveCount(4);

  const rowBox = (await line.boundingBox())!;
  expect(rowBox.height).toBeGreaterThan(72);
  expect(rowBox.height % 24).toBe(0);
  for (const pill of await line.locator(".pill").all()) {
    const box = (await pill.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(rowBox.x + rowBox.width);
    expect(box.y + box.height).toBeLessThanOrEqual(rowBox.y + rowBox.height);
  }
  expect(await line.locator(".paper-body").evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(false);
});

test("a nested row sits one step in under its parent, still without a box", async ({ page }) => {
  await seed(page, [{ title: "Eltern" }, { title: "Kind" }]);
  const list = await page.request.get(`${app.baseUrl}/api/entries?from=${day(0)}&to=${day(0)}`);
  const kid = ((await list.json()).entries as Array<{ id: string; title: string }>).find((entry) => entry.title === "Kind")!;
  expect((await page.request.patch(`${app.baseUrl}/api/entries/${kid.id}`, { data: { indent: 1 } })).status()).toBe(200);
  await page.goto(app.baseUrl);
  await expect(row(page, "Kind")).toBeVisible();

  const parent = (await row(page, "Eltern").locator(".paper-title").boundingBox())!;
  const child = (await row(page, "Kind").locator(".paper-title").boundingBox())!;
  expect(Math.round(child.x - parent.x)).toBe(24);
  expect(await page.locator(".card-child").evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe("0px");
});

test("the day picker opens centred under the date, inside the screen", async ({ page }) => {
  await seed(page, [{ title: "Heute" }, { date: day(-1), title: "Gestern" }]);
  await page.goto(app.baseUrl);
  await expect(row(page, "Heute")).toBeVisible();
  await page.getByTestId("page-date").click();

  const picker = (await page.getByTestId("day-picker").boundingBox())!;
  const screen = page.viewportSize()!;
  expect(Math.abs(picker.x + picker.width / 2 - screen.width / 2)).toBeLessThanOrEqual(1);
  expect(picker.x).toBeGreaterThanOrEqual(0);
  expect(picker.x + picker.width).toBeLessThanOrEqual(screen.width);
  const date = (await page.getByTestId("page-date").boundingBox())!;
  expect(picker.y).toBeGreaterThanOrEqual(date.y + date.height);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("day-picker")).toHaveCount(0);
});

test("not on paper: the list sheet rows are plain too, with the tags after the title", async ({ page }) => {
  await seed(page, [{ date: day(-1), title: "Zahnarzt", tags: ["gesundheit"], time: "14:30" }]);
  await page.goto(app.baseUrl);
  await page.getByTestId("not-on-paper-open").click();
  const listed = page.getByTestId("not-on-paper-row").filter({ hasText: "Zahnarzt" });
  await expect(listed).toBeVisible();
  await expect(listed.locator(".pill")).toHaveText(["gesundheit", "14:30"]);
  await expect(listed.locator("svg.ink-stroke")).toHaveCount(0);

  const title = (await listed.locator(".paper-title").boundingBox())!;
  const tag = (await listed.locator(".pill-tag").boundingBox())!;
  expect(tag.x).toBeGreaterThanOrEqual(title.x + title.width - 1);
  expect(tag.y).toBeLessThan(title.y + title.height);
  expect(await listed.locator(".pill-tag").evaluate((el) => getComputedStyle(el).fontFamily)).toContain("Caveat");
});

test("the not-on-paper mark and the sync dot flow in the same line as the title", async ({ page }) => {
  await seed(page, [{ title: "Unterwegs notiert" }]);
  await page.goto(app.baseUrl);
  const line = row(page, "Unterwegs notiert");
  await expect(line.getByTestId("not-on-paper-mark")).toHaveCount(1);
  const title = (await line.locator(".paper-title").boundingBox())!;
  const mark = (await line.getByTestId("not-on-paper-mark").boundingBox())!;
  expect(mark.x).toBeGreaterThanOrEqual(title.x + title.width - 1);
  expect(Math.abs(mark.y + mark.height / 2 - (title.y + title.height / 2))).toBeLessThan(12);
});
