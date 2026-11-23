import { expect, test, type Page } from "@playwright/test";
import { LIST_PATHS } from "../fake-caldav.ts";
import { openDetails, useBujo } from "./harness.ts";

const app = useBujo({ sync: true });

/** Today as YYYY-MM-DD in the local time zone: the log page uses the local day too. */
function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

type Stored = { id: string; title: string; body: string | null; date: string; hasPhoto: boolean };

/** Removes today's entries and every collection of the test app's own database, so each test starts empty. Local only, never Nextcloud. */
async function clearAll(page: Page): Promise<void> {
  const day = today();
  const lists = [`/api/entries?from=${day}&to=${day}`, "/api/entries?kind=notes"];
  for (const path of lists) {
    const body = (await (await page.request.get(`${app.baseUrl}${path}`)).json()) as { entries: Stored[] };
    for (const entry of body.entries) await page.request.delete(`${app.baseUrl}/api/entries/${entry.id}`);
  }
}

async function seed(page: Page, data: Record<string, unknown>): Promise<Stored> {
  const made = await page.request.post(`${app.baseUrl}/api/entries`, { data: { date: today(), ...data } });
  expect(made.status()).toBe(201);
  return ((await made.json()) as { entry: Stored }).entry;
}

async function notes(page: Page): Promise<Stored[]> {
  return ((await (await page.request.get(`${app.baseUrl}/api/entries?kind=notes`)).json()) as { entries: Stored[] }).entries;
}

test.beforeEach(async ({ page }) => {
  await app.signIn(page);
  await page.addInitScript(() => sessionStorage.setItem("ak-install-prompt-dismissed", "1"));
  await clearAll(page);
});

const noteSheet = (page: Page) => page.getByTestId("note-sheet");
const picker = (page: Page) => page.getByTestId("collect-sheet");

test("New collection opens the note sheet empty, with today as the day, and saves a collection with no photo", async ({ page }) => {
  await page.goto(`${app.baseUrl}/notes`);
  await page.locator('[data-action="new-collection"]').click();
  await expect(noteSheet(page)).toHaveAttribute("data-mode", "new");
  await expect(noteSheet(page).getByRole("heading", { name: "New collection" })).toBeVisible();
  await expect(noteSheet(page).locator('[data-field="title"]')).toHaveValue("");
  await expect(noteSheet(page).locator('[data-field="body"]')).toHaveValue("");
  await expect(noteSheet(page).locator('[data-field="date"]')).toHaveValue(today());
  await expect(noteSheet(page).getByTestId("note-photo")).toHaveCount(0);
  await expect(noteSheet(page).locator('[data-action="note-cancel"]')).toHaveCount(0);

  await noteSheet(page).locator('[data-action="save-note"]').click();
  await expect(noteSheet(page).getByRole("alert")).toContainText("Give the note a title.");
  await noteSheet(page).locator('[data-field="title"]').fill("Camping");
  await noteSheet(page).locator('[data-action="save-note"]').click();
  await expect(noteSheet(page).getByRole("alert")).toContainText("Write something in the note.");

  await noteSheet(page).locator('[data-field="body"]').fill("# Camping\n- Zelt");
  await noteSheet(page).locator('[data-action="save-note"]').click();
  await expect(noteSheet(page)).toHaveCount(0);
  await expect(page.locator(".note-card", { hasText: "Camping" })).toHaveCount(1);
  await expect(page.locator(".note-card", { hasText: "Camping" }).getByTestId("note-placeholder")).toBeVisible();

  const [stored] = await notes(page);
  expect({ title: stored.title, body: stored.body, date: stored.date, hasPhoto: stored.hasPhoto }).toEqual({ title: "Camping", body: "# Camping\n- Zelt", date: today(), hasPhoto: false });
});

test("closing the empty new-collection sheet writes nothing", async ({ page }) => {
  await page.goto(`${app.baseUrl}/notes`);
  await page.locator('[data-action="new-collection"]').click();
  await noteSheet(page).locator('[data-field="title"]').fill("Nur ein Entwurf");
  await page.keyboard.press("Escape");
  await expect(noteSheet(page)).toHaveCount(0);
  expect(await notes(page)).toEqual([]);
});

test("Move to collection: pick one, the line is appended, the entry leaves the page and a trace with the collection title stays", async ({ page }) => {
  const collection = await seed(page, { type: "note", title: "Garten", body: "# Garten\n- Beet 1" });
  await seed(page, { type: "task", title: "Kompost umschichten" });
  await page.goto(app.baseUrl);
  await openDetails(page, "Kompost umschichten");
  await page.locator('[data-action="move-to-collection"]').click();
  await expect(picker(page)).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(picker(page).getByTestId("collect-sub")).toHaveText("Kompost umschichten");
  await expect(picker(page).locator('[data-action="new-collection"]')).toBeVisible();
  await expect(picker(page).locator('[data-action="pick-collection"]')).toHaveText([/Garten/]);

  await picker(page).locator('[data-action="pick-collection"]').click();
  await expect(picker(page)).toHaveCount(0);
  await expect(page.locator(".paper-row:not(.paper-trace)", { hasText: "Kompost umschichten" })).toHaveCount(0);
  const trace = page.getByTestId("trace-row");
  await expect(trace).toHaveCount(1);
  await expect(trace).toHaveAttribute("data-trace", "collected");
  await expect(trace).toContainText("Garten");
  await expect(trace.locator("svg use")).toHaveAttribute("href", "#g-collected");
  await expect(trace.getByRole("img")).toHaveAttribute("aria-label", "Moved to a collection");

  const [stored] = await notes(page);
  expect({ id: stored.id, body: stored.body }).toEqual({ id: collection.id, body: "# Garten\n- Beet 1\n- Kompost umschichten" });
  await page.reload();
  await expect(page.getByTestId("trace-row")).toContainText("Garten");
});

test("Move to collection with New collection asks for a title and a day, and makes the collection", async ({ page }) => {
  await seed(page, { type: "task", title: "Zelt flicken" });
  await page.goto(app.baseUrl);
  await openDetails(page, "Zelt flicken");
  await page.locator('[data-action="move-to-collection"]').click();
  await expect(picker(page).getByTestId("collect-none")).toBeVisible();
  await picker(page).locator('[data-action="new-collection"]').click();
  await expect(picker(page).locator('[data-field="collection-date"]')).toHaveValue(today());

  await picker(page).locator('[data-action="collect-save"]').click();
  await expect(picker(page).getByRole("alert")).toContainText("Give the collection a title.");
  await picker(page).locator('[data-action="collect-back"]').click();
  await expect(picker(page).locator('[data-action="new-collection"]')).toBeVisible();
  await picker(page).locator('[data-action="new-collection"]').click();
  await picker(page).locator('[data-field="collection-title"]').fill("Camping");
  await picker(page).locator('[data-action="collect-save"]').click();
  await expect(picker(page)).toHaveCount(0);

  const [stored] = await notes(page);
  expect({ title: stored.title, body: stored.body, date: stored.date }).toEqual({ title: "Camping", body: "- Zelt flicken", date: today() });
  await expect(page.getByTestId("trace-row")).toContainText("Camping");
  await expect(page.locator(".paper-row:not(.paper-trace)", { hasText: "Zelt flicken" })).toHaveCount(0);
});

test("a full collection refuses the move with its reason, keeps the picker open and the entry on its page", async ({ page }) => {
  await seed(page, { type: "note", title: "Voll", body: "y".repeat(49_999) });
  await seed(page, { type: "task", title: "Zu viel" });
  await page.goto(app.baseUrl);
  await openDetails(page, "Zu viel");
  await page.locator('[data-action="move-to-collection"]').click();
  await picker(page).locator('[data-action="pick-collection"]').click();
  await expect(picker(page).getByRole("alert")).toContainText("collection is full");
  await expect(picker(page)).toBeVisible();
  await picker(page).locator('[data-action="collect-cancel"]').click();
  await expect(picker(page)).toHaveCount(0);
  await expect(page.locator(".paper-row", { hasText: "Zu viel" })).toHaveCount(1);
  await expect(page.getByTestId("trace-row")).toHaveCount(0);
});

test("a synced task is cancelled in the fake Nextcloud when it moves, and nothing is deleted there", async ({ page }) => {
  await seed(page, { type: "note", title: "Haus", body: "- eins" });
  await seed(page, { type: "task", title: "Dachrinne reinigen" });
  await page.goto(app.baseUrl);
  const box = LIST_PATHS["bujo-test"];
  await expect.poll(() => app.fake.names(box).filter((name) => app.fake.read(box, name)!.includes("Dachrinne reinigen")).length).toBe(1);
  await expect.poll(async () => (await (await page.request.get(`${app.baseUrl}/api/entries?from=${today()}&to=${today()}`)).json()).entries.find((e: Stored) => e.title === "Dachrinne reinigen").sync).toBe("synced");
  const before = app.fake.names(box);

  await openDetails(page, "Dachrinne reinigen");
  await page.locator('[data-action="move-to-collection"]').click();
  await picker(page).locator('[data-action="pick-collection"]').click();
  await expect(picker(page)).toHaveCount(0);

  const cancelled = before.filter((name) => app.fake.read(box, name)!.includes("Dachrinne reinigen"));
  expect(cancelled).toHaveLength(1);
  expect(app.fake.read(box, cancelled[0])!).toContain("STATUS:CANCELLED");
  expect(app.fake.requests.some((request) => request.method === "DELETE")).toBe(false);
  expect(app.fake.names(box)).toEqual(before);
});

test("an entry sheet has the Move to collection action, and a short note too", async ({ page }) => {
  await seed(page, { type: "note", title: "Kurze Notiz" });
  await page.goto(app.baseUrl);
  await openDetails(page, "Kurze Notiz");
  await expect(page.locator('[data-action="move-to-collection"]')).toHaveText("Move to collection");
});
