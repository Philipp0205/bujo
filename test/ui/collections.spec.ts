import { expect, test, type Page } from "@playwright/test";
import { gotoNotebook, openNoteEditor, useBujo, WHATS_NEW_NEWEST } from "./harness.ts";

const app = useBujo();

test.beforeEach(async ({ page }) => {
  await app.signIn(page);
  // The install banner and the what's new sheet would sit over the page, so both are out of the way before any page script runs.
  await page.addInitScript(() => sessionStorage.setItem("ak-install-prompt-dismissed", "1"));
  await page.request.put(`${app.baseUrl}/api/whats-new/seen`, { data: { id: WHATS_NEW_NEWEST } });
});

/** Today as YYYY-MM-DD in the local time zone, which is the day the log shows. */
function today(): string {
  const date = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const rowOf = (page: Page, title: string) => page.locator(".paper-row", { hasText: title });

async function openNotes(page: Page): Promise<void> {
  await gotoNotebook(page, app.baseUrl);
  await expect(page.getByTestId("new-note")).toBeVisible();
}

/** Makes a collection from the index with the name typed in the chooser, and waits for its page. */
async function createCollection(page: Page, name: string): Promise<void> {
  await page.getByTestId("new-collection").click();
  await page.getByTestId("collection-name").fill(name);
  await page.locator("[data-action=create-collection]").click();
  await expect(page.getByTestId("collection-title")).toHaveText(name);
}

/** A long press with the mouse on a locator: press, hold past the hold time, release. */
async function hold(page: Page, target: ReturnType<typeof rowOf>): Promise<void> {
  const box = (await target.locator(".paper-sym").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
}

test("a free-form note is written on the Notes screen without a scan: several lines, saved, on the grid", async ({ page }) => {
  await openNotes(page);
  await page.getByTestId("new-note").click();
  const sheet = page.getByTestId("note-sheet");
  await expect(sheet).toHaveAttribute("data-mode", "new");
  await sheet.locator("[data-field=title]").fill("Trip ideas");
  await sheet.locator("[data-field=body]").fill("# Trip\n\n- the coast\n- the hills");
  await sheet.locator("[data-action=save-note]").click();
  await expect(sheet).toHaveCount(0);

  const card = page.getByTestId("note-grid").locator(".note-card", { hasText: "Trip ideas" });
  await expect(card).toBeVisible();
  await expect(page.getByTestId("note-placeholder").first()).toBeVisible();
  await card.click();
  await openNoteEditor(page.getByTestId("note-sheet"));
  await expect(page.getByTestId("note-sheet").locator("[data-field=body]")).toHaveValue("# Trip\n\n- the coast\n- the hills");

  const listed = await page.request.get(`${app.baseUrl}/api/entries?kind=notes`);
  const notes = (await listed.json()).entries as Array<{ title: string; type: string; body: string; hasPhoto: boolean }>;
  const saved = notes.find((note) => note.title === "Trip ideas")!;
  expect(saved.type).toBe("note");
  expect(saved.body.split("\n")).toHaveLength(4);
  expect(saved.hasPhoto).toBe(false);
});

test("a collection is created, listed in the index, opened, filled and ticked like the log", async ({ page }) => {
  await openNotes(page);
  await createCollection(page, "books to read");

  await expect(page.getByTestId("collection-page")).toBeVisible();
  await page.getByTestId("collection-add-input").fill("Dune");
  await page.locator("[data-action=collection-add]").click();
  await expect(rowOf(page, "Dune")).toBeVisible();
  await page.getByTestId("collection-add-input").fill("Emma");
  await page.keyboard.press("Enter");
  await expect(rowOf(page, "Emma")).toBeVisible();

  await rowOf(page, "Dune").getByTestId("toggle-done").click();
  await expect(rowOf(page, "Dune")).toHaveAttribute("data-type", "done");
  await expect(rowOf(page, "Emma")).toHaveAttribute("data-type", "task");

  await page.locator("[data-action=collection-back]").click();
  const index = page.getByTestId("collection-index");
  await expect(index.getByTestId("collection-row").filter({ hasText: "books to read" })).toContainText("2 entries");
  await index.getByTestId("collection-row").filter({ hasText: "books to read" }).click();
  await expect(rowOf(page, "Dune")).toHaveAttribute("data-type", "done");
});

test("a task of the log is filed on a collection from its type picker, and leaves the day", async ({ page }) => {
  const made = await page.request.post(`${app.baseUrl}/api/collections`, { data: { name: "garden jobs" } });
  const collection = (await made.json()).collection as { id: string };
  const task = await page.request.post(`${app.baseUrl}/api/entries`, { data: { date: today(), type: "task", title: "Prune roses" } });
  expect(task.status()).toBe(201);

  await page.goto(app.baseUrl);
  await expect(page.getByRole("heading", { name: "Daily Log", level: 1 })).toBeVisible();
  await expect(rowOf(page, "Prune roses")).toBeVisible();
  await hold(page, rowOf(page, "Prune roses"));
  await page.getByTestId("collection-toggle").click();
  await page.getByTestId("collection-choice").filter({ hasText: "garden jobs" }).click();
  await expect(rowOf(page, "Prune roses")).toHaveCount(0);

  const filed = await page.request.get(`${app.baseUrl}/api/entries?collection=${collection.id}`);
  expect(((await filed.json()).entries as Array<{ title: string }>).map((entry) => entry.title)).toEqual(["Prune roses"]);

  await openNotes(page);
  await page.getByTestId("collection-row").filter({ hasText: "garden jobs" }).click();
  await expect(rowOf(page, "Prune roses")).toBeVisible();
});

test("a collection is renamed from its page: the title and the index row change, a clash is refused", async ({ page }) => {
  await page.request.post(`${app.baseUrl}/api/collections`, { data: { name: "films" } });
  await openNotes(page);
  await createCollection(page, "recipes");

  await page.getByTestId("collection-rename-open").click();
  const input = page.getByTestId("collection-name");
  await expect(input).toHaveValue("recipes");
  await input.fill("FILMS");
  await page.locator("[data-action=rename-collection]").click();
  await expect(page.getByTestId("collection-note")).toHaveText("Another collection already has that name.");

  await input.fill("Baking recipes");
  await page.locator("[data-action=rename-collection]").click();
  await expect(page.getByTestId("collection-rename")).toHaveCount(0);
  await expect(page.getByTestId("collection-title")).toHaveText("Baking recipes");

  await page.locator("[data-action=collection-back]").click();
  const index = page.getByTestId("collection-index");
  await expect(index.getByTestId("collection-row").filter({ hasText: "Baking recipes" })).toBeVisible();
  await expect(index.getByTestId("collection-row").filter({ hasText: /^recipes/ })).toHaveCount(0);
});

test("deleting a collection asks first: cancel keeps the page, confirm removes it with its entries, none is back on the log", async ({ page }) => {
  const made = await page.request.post(`${app.baseUrl}/api/collections`, { data: { name: "herb beds" } });
  const collection = (await made.json()).collection as { id: string };
  const task = await page.request.post(`${app.baseUrl}/api/entries`, { data: { date: today(), type: "task", title: "Sow basil", collectionId: collection.id } });
  expect(task.status()).toBe(201);

  await openNotes(page);
  await page.getByTestId("collection-row").filter({ hasText: "herb beds" }).click();
  await page.getByTestId("collection-delete-open").click();
  await expect(page.getByTestId("collection-confirm")).toContainText("its entries and its photos will be deleted");
  await page.getByTestId("collection-delete-cancel").click();
  await expect(page.getByTestId("collection-confirm")).toHaveCount(0);
  await expect(page.getByTestId("collection-title")).toHaveText("herb beds");
  await expect(rowOf(page, "Sow basil")).toBeVisible();

  await page.getByTestId("collection-delete-open").click();
  await page.getByTestId("collection-delete-confirm").click();
  await expect(page.getByTestId("new-collection")).toBeVisible();
  await expect(page.getByTestId("collection-row").filter({ hasText: "herb beds" })).toHaveCount(0);

  await page.goto(app.baseUrl);
  await expect(page.getByRole("heading", { name: "Daily Log", level: 1 })).toBeVisible();
  await expect(rowOf(page, "Sow basil")).toHaveCount(0);
  const day = (await (await page.request.get(`${app.baseUrl}/api/entries?from=${today()}&to=${today()}`)).json()).entries as Array<{ title: string }>;
  expect(day.map((item) => item.title)).not.toContain("Sow basil");
});

test("add to index: a page number lists the collection with that number, and clearing it removes the listing", async ({ page }) => {
  const made = await page.request.post(`${app.baseUrl}/api/collections`, { data: { name: "herb beds" } });
  const collection = (await made.json()).collection as { id: string };
  await openNotes(page);
  await page.getByTestId("collection-row").filter({ hasText: "herb beds" }).click();
  await expect(page.getByTestId("collection-page-open")).toHaveText("Add to index");
  await page.getByTestId("collection-page-open").click();
  await page.getByTestId("collection-page-input").fill("31");
  await page.locator("[data-action=save-page]").click();
  await expect(page.getByTestId("collection-page-mark")).toHaveText("p. 31");

  const listed = async () => ((await (await page.request.get(`${app.baseUrl}/api/index`)).json()).pages as Array<{ number: number; ref: string }>).filter((item) => item.ref === collection.id);
  expect((await listed()).map((item) => item.number)).toEqual([31]);

  await page.getByTestId("collection-page-open").click();
  await page.getByTestId("collection-page-clear").click();
  await expect(page.getByTestId("collection-page-mark")).toHaveCount(0);
  expect(await listed()).toEqual([]);
});
