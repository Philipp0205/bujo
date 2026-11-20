import { expect, test } from "@playwright/test";
import { useBujo } from "./harness.ts";

const app = useBujo();

test.beforeEach(async ({ page }) => {
  await app.signIn(page);
});

test("create a read token, see it once, then only its prefix, and revoke it with a confirm", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(`${app.baseUrl}/settings`);
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  await expect(page.locator("[data-state=no-tokens]")).toBeVisible();

  await page.locator("#token-name").fill("Claude");
  await page.locator("[data-action=create-token]").click();

  const shown = page.locator("[data-testid=new-token]");
  await expect(shown).toBeVisible();
  const token = (await shown.textContent())!.trim();
  expect(token).toMatch(/^bujo_[A-Za-z0-9_-]{43}$/);

  const rows = page.locator("[data-list=tokens] li");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Claude");
  await expect(rows.first()).toContainText("read");
  await expect(rows.first()).not.toContainText(token);

  // The token works on the API, then the panel goes away for good.
  const ok = await page.request.get(`${app.baseUrl}/api/v1/lists`, { headers: { authorization: `Bearer ${token}` } });
  expect(ok.status()).toBe(200);
  await page.locator("[data-action=dismiss-token]").click();
  await expect(shown).toHaveCount(0);
  await page.reload();
  await expect(page.locator("[data-testid=new-token]")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(token);

  // Revoke asks first. Keep leaves it alone, Revoke removes it.
  await page.locator("[data-action=revoke]").click();
  await page.locator("[data-action=cancel-revoke]").click();
  await expect(rows).toHaveCount(1);
  await page.locator("[data-action=revoke]").click();
  await page.locator("[data-action=confirm-revoke]").click();
  await expect(page.locator("[data-list=tokens] li[data-token-id]")).toHaveCount(0);
  await expect(page.locator("[data-state=no-tokens]")).toBeVisible();

  const gone = await page.request.get(`${app.baseUrl}/api/v1/lists`, { headers: { authorization: `Bearer ${token}` } });
  expect(gone.status()).toBe(401);
  expect(errors).toEqual([]);
});

test("a write token can be created with the access switch", async ({ page }) => {
  await page.goto(`${app.baseUrl}/settings`);
  await page.locator("[data-scope=write]").click();
  await expect(page.locator("[data-scope=write]")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#token-name").fill("Writer");
  await page.locator("[data-action=create-token]").click();
  await expect(page.locator("[data-panel=new-token]")).toContainText("(write)");
  const token = (await page.locator("[data-testid=new-token]").textContent())!.trim();
  const created = await page.request.post(`${app.baseUrl}/api/v1/tasks`, {
    headers: { authorization: `Bearer ${token}` },
    data: { summary: "Aus dem UI-Test" },
  });
  expect(created.status()).toBe(201);
});

test("the account section shows the email state", async ({ page }) => {
  await page.goto(`${app.baseUrl}/settings`);
  // The harness uses the kit's stub mailer, so sending counts as on.
  await expect(page.locator("[data-testid=email-status]")).toHaveText("Not confirmed yet.");
  await expect(page.getByLabel("Email")).toHaveValue("philipp@example.com");
});

test("a signed-out visitor is sent to sign in", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${app.baseUrl}/settings`);
  await expect(page).toHaveURL(/\/signin$/);
  await context.close();
});
