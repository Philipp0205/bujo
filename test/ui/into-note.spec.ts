import { expect, test, type Page } from "@playwright/test";
import { openNoteEditor, openSavedNote, useBujo, WHATS_NEW_NEWEST } from "./harness.ts";

const app = useBujo();

test.beforeEach(async ({ page }) => {
  await app.signIn(page);
  await page.addInitScript(() => sessionStorage.setItem("ak-install-prompt-dismissed", "1"));
  await page.request.put(`${app.baseUrl}/api/whats-new/seen`, { data: { id: WHATS_NEW_NEWEST } });
});

const made: string[] = [];

test.afterEach(async ({ page }) => {
  for (const id of made.splice(0)) await page.request.delete(`${app.baseUrl}/api/entries/${id}`);
});

/** Today as YYYY-MM-DD in the local time zone, which is the day the page shows. */
function today(): string {
  const date = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** A fake entry through the API with the page's session. Never a real list. */
async function seed(page: Page, data: Record<string, unknown>): Promise<string> {
  const response = await page.request.post(`${app.baseUrl}/api/entries`, { data: { date: today(), ...data } });
  expect(response.status()).toBe(201);
  const id: string = (await response.json()).entry.id;
  made.push(id);
  return id;
}

async function notes(page: Page): Promise<Array<{ id: string; body: string }>> {
  return (await (await page.request.get(`${app.baseUrl}/api/entries?kind=notes`)).json()).entries;
}

async function openLog(page: Page): Promise<void> {
  await page.goto(app.baseUrl);
  await expect(page.getByRole("heading", { name: "Daily Log", level: 1 })).toBeVisible();
  await page.waitForFunction(() => !!document.querySelector(".paper-add"));
}

/** Long press on the marker of the row, then the note row of the picker. */
async function openChooser(page: Page, title: string): Promise<void> {
  const target = page.locator(".paper-row", { hasText: title }).locator(".paper-sym");
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
  await page.getByTestId("into-note-toggle").click();
}

test("a task is filed into a free-form note as a line and leaves the log", async ({ page }) => {
  const noteId = await seed(page, { type: "note", title: "Ideas", body: "- first" });
  await seed(page, { type: "note", title: "Just a dash note" });
  await seed(page, { type: "task", title: "Stamps kaufen" });
  await openLog(page);

  await openChooser(page, "Stamps kaufen");
  await expect(page.getByTestId("into-choice")).toHaveCount(1);
  await page.getByTestId("into-choice").click();

  await expect(page.locator(".paper-row", { hasText: "Stamps kaufen" })).toHaveCount(0);
  const note = (await notes(page)).find((item) => item.id === noteId)!;
  expect(note.body).toBe("- first\n- Stamps kaufen\n");

  // The note on the page is the saved one, so editing it later starts from the new body.
  await openSavedNote(page, app.baseUrl, "Ideas");
  await openNoteEditor(page.getByTestId("note-sheet"));
  await expect(page.locator("[data-field=body]")).toHaveValue("- first\n- Stamps kaufen\n");
});

test("with no free-form note the chooser says so and offers a new note", async ({ page }) => {
  await seed(page, { type: "task", title: "Allein" });
  await openLog(page);
  await openChooser(page, "Allein");
  await expect(page.getByTestId("into-empty")).toBeVisible();
  await expect(page.getByTestId("into-choice")).toHaveCount(0);
  await page.getByTestId("into-new-note").click();
  await expect(page.getByTestId("note-sheet")).toBeVisible();
});

test("the note row is not offered on an event", async ({ page }) => {
  await seed(page, { type: "event", title: "Zahnarzt", time: "09:00" });
  await openLog(page);
  const target = page.locator(".paper-row", { hasText: "Zahnarzt" }).locator(".paper-sym");
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
  await expect(page.getByTestId("type-chooser")).toBeVisible();
  await expect(page.getByTestId("into-note-toggle")).toHaveCount(0);
});
