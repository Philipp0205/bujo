import { expect, test } from "@playwright/test";
import { useBujo } from "./harness.ts";

const app = useBujo();
const confirmed = useBujo();
const emailOff = useBujo({ emailOff: true });

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

test("an unconfirmed account with email on can send the confirmation link again", async ({ page }) => {
  const confirmMails = () => app.mailer.sent.filter((m) => m.subject.startsWith("Confirm your email"));
  const before = confirmMails().length;
  await page.goto(`${app.baseUrl}/settings`);
  const button = page.getByRole("button", { name: "Send confirmation link again" });
  await expect(button).toBeVisible();
  await expect(button).toHaveClass(/ak-btn-secondary/);
  await expect(page.locator("#email")).toHaveAttribute("autocapitalize", "none");
  await expect(page.locator("#email")).toHaveAttribute("autocorrect", "off");
  await expect(page.locator("#email")).toHaveAttribute("spellcheck", "false");

  // The saved address is used, not what is typed in the field.
  await page.locator("#email").fill("typed-but-not-saved@example.com");
  await button.click();
  await expect(page.locator(".bj-slot").first()).toContainText("Confirmation link sent to philipp@example.com.");
  expect(confirmMails().length).toBe(before + 1);
  expect(confirmMails().at(-1)!.to).toBe("philipp@example.com");
});

test("no resend button when the email is confirmed", async ({ page }) => {
  await confirmed.signIn(page);
  const mail = confirmed.mailer.sent.find((m) => m.subject.startsWith("Confirm your email"))!;
  const token = /#t=([A-Za-z0-9_-]+)/.exec(mail.text)![1];
  const verified = await page.request.post(`${confirmed.baseUrl}/api/auth/verify`, { data: { token } });
  expect(verified.status()).toBe(200);
  await page.goto(`${confirmed.baseUrl}/settings`);
  await expect(page.locator("[data-testid=email-status]")).toHaveText("Confirmed.");
  await expect(page.getByRole("button", { name: "Send confirmation link again" })).toHaveCount(0);
});

test("no resend button when email sending is off", async ({ page }) => {
  await emailOff.signIn(page);
  await page.goto(`${emailOff.baseUrl}/settings`);
  await expect(page.locator("[data-testid=email-status]")).toContainText("Email sending is off on this server");
  await expect(page.getByRole("button", { name: "Send confirmation link again" })).toHaveCount(0);
});

test("a signed-out visitor is sent to sign in", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${app.baseUrl}/settings`);
  await expect(page).toHaveURL(/\/signin$/);
  await context.close();
});
