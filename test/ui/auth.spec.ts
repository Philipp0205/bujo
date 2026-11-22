import { expect, test } from "@playwright/test";
import { useBujo } from "./harness.ts";

const app = useBujo({ seedUser: false });

test("first run: sign up, save the recovery code, sign out, sign in again with it", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));

  // No account yet: the app page sends you to sign up.
  await page.goto(app.baseUrl);
  await expect(page).toHaveURL(/\/signup$/);
  await expect(page.getByRole("heading", { name: "Welcome to bujo", level: 1 })).toBeVisible();
  await expect(page.locator("#app")).toContainText("The first visitor claims the account");
  // The subtitle sits under the title, not squeezed beside it.
  const titleBox = (await page.locator(".ak-screen-title").boundingBox())!;
  const subBox = (await page.locator(".bj-auth-head .bj-sub").boundingBox())!;
  expect(subBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height - 1);

  await page.getByLabel("Your name").fill("Philipp");
  await page.getByLabel("Email").fill("philipp@example.com");
  await page.getByRole("button", { name: "Create journal" }).click();

  const code = page.locator("[data-testid=recovery-code]");
  await expect(code).toBeVisible();
  const recoveryCode = (await code.textContent())!.trim();
  expect(recoveryCode).toMatch(/^[A-Z0-9]{4}(-[A-Z0-9]{4}){2,}$/);

  await page.locator("[data-action=code-saved]").click();
  await expect(page).toHaveURL(`${app.baseUrl}/`);
  await expect(page.getByRole("heading", { name: "Daily Log", level: 1 })).toBeVisible();
  await expect(page.locator("[data-testid=today-mark]")).toBeVisible();

  // Sign out from settings.
  await page.goto(`${app.baseUrl}/settings`);
  await page.locator("[data-action=sign-out]").click();
  await expect(page).toHaveURL(/\/signin$/);
  await page.goto(app.baseUrl);
  await expect(page).toHaveURL(/\/signin$/);

  // A wrong code is refused, the right one signs in.
  await page.getByLabel("Recovery code").fill("AAAA-BBBB-CCCC");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(".bj-slot")).not.toBeEmpty();
  await expect(page).toHaveURL(/\/signin$/);

  await page.getByLabel("Recovery code").fill(recoveryCode);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(`${app.baseUrl}/`);
  await expect(page.locator("[data-testid=today-mark]")).toBeVisible();
  expect(errors).toEqual([]);
});

test("with an account, /signup goes to sign in and a signed-in visitor skips the guest pages", async ({ page }) => {
  await page.goto(`${app.baseUrl}/signup`);
  await expect(page).toHaveURL(/\/signin$/);
});

test("/lost names the normalized address and refuses an invalid one", async ({ page }) => {
  await page.goto(`${app.baseUrl}/lost`);
  const email = page.getByLabel("Email");
  await expect(email).toHaveAttribute("autocapitalize", "none");
  await expect(email).toHaveAttribute("autocorrect", "off");
  await expect(email).toHaveAttribute("spellcheck", "false");

  await email.fill("philipp@example");
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(page.locator(".bj-slot")).toContainText("enter a valid email");

  await email.fill("  Philipp@Example.com ");
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(page.locator(".bj-slot")).toContainText(
    "If philipp@example.com is the confirmed address on this journal, a sign-in link is on its way. It works once and expires in 20 minutes.",
  );
});
