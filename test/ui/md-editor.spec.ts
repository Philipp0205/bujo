import { expect, test, type Locator, type Page } from "@playwright/test";
import { useBujo, WHATS_NEW_NEWEST } from "./harness.ts";

const app = useBujo();

const BODY = "# Garden plan\nPlant **carrots** early.\n- beds\n- [ ] buy seed";

test.beforeEach(async ({ page }) => {
  await app.signIn(page);
  await page.addInitScript(() => sessionStorage.setItem("ak-install-prompt-dismissed", "1"));
  await page.request.put(`${app.baseUrl}/api/whats-new/seen`, { data: { id: WHATS_NEW_NEWEST } });
});

/** Today as YYYY-MM-DD in the local time zone: the log page uses the local day too. */
function localDay(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const sheet = (page: Page) => page.getByTestId("note-sheet");
const area = (page: Page) => sheet(page).locator('[data-field="body"]');

/** Seeds a saved note through the test API (never a real list), opens the log and opens that note's sheet. */
async function openSaved(page: Page, title: string, body: string): Promise<void> {
  const made = await page.request.post(`${app.baseUrl}/api/entries`, { data: { date: localDay(), type: "note", title, body } });
  expect(made.status()).toBe(201);
  await page.goto(app.baseUrl);
  await page.evaluate(() => document.fonts.ready);
  await page.locator(".paper-row", { hasText: title }).click();
  await expect(sheet(page)).toHaveAttribute("data-mode", "saved");
}

/** Selects a range of the textarea text and keeps focus there. */
async function select(box: Locator, start: number, end: number): Promise<void> {
  await box.focus();
  await box.evaluate((el: HTMLTextAreaElement, range) => el.setSelectionRange(range[0], range[1]), [start, end]);
}

test("a saved note opens as rendered preview, with title and Edit visible and no raw markers", async ({ page }) => {
  await openSaved(page, "Beete", BODY);
  const preview = sheet(page).getByTestId("note-preview");
  await expect(preview).toBeVisible();
  await expect(preview.locator("h3")).toHaveText("Garden plan");
  await expect(preview.locator("strong")).toHaveText("carrots");
  await expect(preview).not.toContainText("**");
  await expect(preview.locator("li")).toHaveCount(2);
  await expect(area(page)).toBeHidden();
  await expect(sheet(page).getByTestId("note-toolbar")).toBeHidden();
  await expect(sheet(page).locator('[data-field="title"]')).toBeVisible();
  await expect(sheet(page).locator('[data-action="copy-note"]')).toBeVisible();
});

test("Edit shows the textarea with the markdown and the toolbar", async ({ page }) => {
  await openSaved(page, "Beete zwei", BODY);
  await sheet(page).locator('[data-action="note-edit"]').click();
  await expect(area(page)).toBeVisible();
  await expect(area(page)).toHaveValue(BODY);
  for (const tool of ["heading", "bold", "italic", "list", "checkbox", "link"]) {
    await expect(sheet(page).locator(`[data-action="md-${tool}"]`)).toBeVisible();
  }
  await expect(sheet(page).getByTestId("note-preview")).toBeHidden();
});

test("bold wraps the selection, Preview shows it without saving, and Edit still has the text", async ({ page }) => {
  await openSaved(page, "Beete drei", BODY);
  await sheet(page).locator('[data-action="note-edit"]').click();
  await select(area(page), 2, 8);
  await sheet(page).locator('[data-action="md-bold"]').click();
  await expect(area(page)).toHaveValue(BODY.replace("Garden", "**Garden**"));

  await sheet(page).locator('[data-action="note-preview"]').click();
  await expect(sheet(page).getByTestId("note-preview").locator("h3 strong")).toHaveText("Garden");
  const stored = await page.request.get(`${app.baseUrl}/api/entries?kind=notes`);
  expect(JSON.stringify(await stored.json())).not.toContain("**Garden**");

  await sheet(page).locator('[data-action="note-edit"]').click();
  await expect(area(page)).toHaveValue(BODY.replace("Garden", "**Garden**"));
});

test("Enter continues a list, Enter on an empty item ends it, Tab indents and Shift+Tab outdents", async ({ page }) => {
  await openSaved(page, "Liste", "- one");
  await sheet(page).locator('[data-action="note-edit"]').click();
  await select(area(page), 5, 5);
  await page.keyboard.press("Enter");
  await page.keyboard.type("two");
  await expect(area(page)).toHaveValue("- one\n- two");
  await page.keyboard.press("Tab");
  await expect(area(page)).toHaveValue("- one\n  - two");
  await page.keyboard.press("Shift+Tab");
  await expect(area(page)).toHaveValue("- one\n- two");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(area(page)).toHaveValue("- one\n- two\n");
  await expect(area(page)).toBeFocused();
});

test("HTML and javascript links in a note render as text, with no script run and no javascript href", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("dialog", (dialog) => {
    errors.push(`dialog: ${dialog.message()}`);
    void dialog.dismiss();
  });
  await openSaved(page, "Unsicher", "<script>window.__pwned = 1</script>\n<img src=x onerror=\"window.__pwned = 2\">\n[click](javascript:window.__pwned=3) and [ok](https://example.com)");
  const preview = sheet(page).getByTestId("note-preview");
  await expect(preview).toContainText("<script>");
  await expect(preview.locator("script, img")).toHaveCount(0);
  await expect(preview.locator('a[href^="javascript"]')).toHaveCount(0);
  await expect(preview.locator("a")).toHaveCount(1);
  await expect(preview.locator("a")).toHaveAttribute("href", "https://example.com");
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  expect(errors).toEqual([]);
});

test("a new note starts in edit mode with the toolbar", async ({ page }) => {
  await page.goto(`${app.baseUrl}/notes.html`);
  await page.getByTestId("new-note").click();
  await expect(sheet(page)).toHaveAttribute("data-mode", "new");
  await expect(area(page)).toBeVisible();
  await expect(sheet(page).getByTestId("note-toolbar")).toBeVisible();
});
