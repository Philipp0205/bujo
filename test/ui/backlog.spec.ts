import { expect, test } from "@playwright/test";
import { useBujo } from "./harness.ts";

const app = useBujo();

test.beforeEach(async ({ page }) => {
  await app.signIn(page);
});

test("without a session the backlog page sends you to sign in", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${app.baseUrl}/backlog`);
  await expect(page).toHaveURL(/\/signin$/);
  await expect(page.getByRole("heading", { name: "Sign in", level: 1 })).toBeVisible();
  await context.close();
});

test("the backlog renders rows with list, due date, priority and tags at 390x844", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(`${app.baseUrl}/backlog`);

  await expect(page.getByRole("heading", { name: "Backlog", level: 1 })).toBeVisible();
  const rows = page.locator("li.ak-row");
  await expect(rows).toHaveCount(6);
  expect(page.viewportSize()).toEqual({ width: 390, height: 844 });

  const gutachten = page.locator('li[data-uid="fx-gutachten"]');
  await expect(gutachten).toContainText("Gutachten lesen, kommentieren; abgeben");
  await expect(gutachten).toContainText("Aufgaben");
  await expect(gutachten).toContainText(/Due Tue,? 1 Dec/);
  await expect(gutachten.locator(".bj-prio")).toHaveAttribute("data-priority", "1");
  await expect(gutachten.locator(".ak-chip")).toHaveText(["Arbeit, intern", "Gutachten"]);
  await expect(page.locator('li[data-uid="fx-bericht"]')).toContainText("Arbeit");
  await expect(page.locator('li[data-uid="fx-termin"]')).toContainText("09:30");
  // Completed and cancelled tasks are not in the default list.
  await expect(page.locator('li[data-uid="fx-done"]')).toHaveCount(0);
  await expect(page.locator('li[data-uid="fx-cancelled"]')).toHaveCount(0);
  // No stray text nodes (an empty slot once rendered as the word null).
  expect(await page.locator("#app").evaluate((el) => [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent!.trim()).length)).toBe(0);
  expect(errors).toEqual([]);
});

test("switching filters changes what is listed", async ({ page }) => {
  await page.goto(`${app.baseUrl}/backlog`);
  await expect(page.locator("li.ak-row")).toHaveCount(6);
  const pressed = (id: string) => page.locator(`[data-filter="${id}"]`);

  await pressed("someday").click();
  await expect(pressed("someday")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("li.ak-row")).toHaveCount(1);
  await expect(page.locator('li[data-uid="fx-someday"]')).toBeVisible();

  await pressed("scheduled").click();
  await expect(page.locator("li.ak-row")).toHaveCount(3);
  // Sorted by due date: 24 Nov, 30 Nov, 1 Dec.
  await expect(page.locator("li.ak-row")).toHaveText([/Zahnarzt/, /Bericht/, /Gutachten/]);

  await pressed("priority").click();
  await expect(page.locator(".bj-group-title")).toHaveText(["High", "Medium", "Low", "No priority"]);

  await pressed("tag").click();
  await expect(page.locator(".bj-group-title")).toHaveText(["Arbeit, intern", "Bericht", "Gutachten", "Haushalt", "someday", "No tag"]);

  await pressed("open").click();
  await expect(page.locator("li.ak-row")).toHaveCount(6);
});

test("an empty filter shows the empty state", async ({ page }) => {
  await page.route("**/api/backlog", (route) =>
    route.fulfill({ json: { source: "caldav", lists: ["Aufgaben", "Arbeit"], tasks: [] } }),
  );
  await page.goto(`${app.baseUrl}/backlog`);
  await expect(page.locator('[data-state="empty"]')).toContainText("Nothing open");
});

test("a failing task server shows an error state with a retry", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/backlog", (route) => {
    calls += 1;
    return calls === 1
      ? route.fulfill({ status: 502, json: { error: "The task server did not answer. Try again in a moment." } })
      : route.continue();
  });
  await page.goto(`${app.baseUrl}/backlog`);
  await expect(page.locator('[data-state="error"]')).toContainText("did not answer");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator("li.ak-row")).toHaveCount(6);
});

test("light and dark follow the system color scheme through the paper tokens", async ({ page }, testInfo) => {
  await page.goto(`${app.baseUrl}/backlog`);
  await expect(page.locator("li.ak-row")).toHaveCount(6);
  const scheme = testInfo.project.name === "phone-dark" ? "dark" : "light";
  expect(await page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches)).toBe(scheme === "dark");
  const colors = await page.evaluate(() => ({
    bg: getComputedStyle(document.body).backgroundColor,
    text: getComputedStyle(document.body).color,
    accent: getComputedStyle(document.documentElement).getPropertyValue("--ak-accent").trim(),
  }));
  if (scheme === "dark") {
    expect(colors).toEqual({ bg: "rgb(22, 19, 15)", text: "rgb(243, 238, 225)", accent: "#f3eee1" });
  } else {
    expect(colors).toEqual({ bg: "rgb(244, 239, 228)", text: "rgb(23, 19, 15)", accent: "#17130f" });
  }
});
