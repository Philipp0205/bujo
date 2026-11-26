import { expect, test, type Page } from "@playwright/test";
import { useBujo } from "./harness.ts";

const app = useBujo();

test.beforeEach(async ({ page }) => {
  await app.signIn(page);
  await page.addInitScript(() => sessionStorage.setItem("ak-install-prompt-dismissed", "1"));
});

/** A calendar day as YYYY-MM-DD in the local time zone, n days from today. */
function day(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Opens select mode on a fresh fake entry through a clock-frozen long press. */
async function selectOne(page: Page, title: string): Promise<void> {
  const made = await page.request.post(`${app.baseUrl}/api/entries`, { data: { date: day(20), type: "task", title } });
  expect(made.status()).toBe(201);
  await page.goto(`${app.baseUrl}/?day=${day(20)}`);
  await page.waitForLoadState("networkidle");
  const row = page.locator(".paper-row", { hasText: title });
  await row.evaluate((node) => node.scrollIntoView({ block: "center" }));
  const box = (await row.boundingBox())!;
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 60_000));
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.clock.runFor(650);
  await page.mouse.up();
  await expect(page.getByTestId("select-bar")).toBeVisible();
}

const plugin = (page: Page) => page.locator("[data-plugin-id='bujo.bulk-delete']");

test("Settings > Plugins lists the plugin with name, description, version and a switch that is on", async ({ page }) => {
  await page.goto(`${app.baseUrl}/settings`);
  await expect(page.getByRole("heading", { name: "Plugins", level: 2 })).toBeVisible();
  await expect(plugin(page)).toContainText("Bulk delete");
  await expect(plugin(page)).toContainText("Delete several entries");
  await expect(plugin(page)).toContainText("Version 1");
  await expect(plugin(page).getByRole("switch")).toHaveAttribute("aria-checked", "true");
});

test("switching bulk delete off removes Delete from the select bar, and on brings it back", async ({ page }) => {
  await page.goto(`${app.baseUrl}/settings`);
  await plugin(page).getByRole("switch").click();
  await expect(plugin(page).getByRole("switch")).toHaveAttribute("aria-checked", "false");

  await selectOne(page, "Ohne Loeschen");
  await expect(page.locator("[data-action=select-copy]")).toBeVisible();
  await expect(page.getByTestId("select-delete")).toHaveCount(0);

  await page.goto(`${app.baseUrl}/settings`);
  await expect(plugin(page).getByRole("switch")).toHaveAttribute("aria-checked", "false");
  await plugin(page).getByRole("switch").click();
  await expect(plugin(page).getByRole("switch")).toHaveAttribute("aria-checked", "true");

  await selectOne(page, "Mit Loeschen");
  await expect(page.getByTestId("select-delete")).toBeEnabled();
  await page.getByTestId("select-delete").click();
  await page.getByTestId("select-delete-confirm").click();
  await expect(page.locator(".paper-row", { hasText: "Mit Loeschen" })).toHaveCount(0);
});
