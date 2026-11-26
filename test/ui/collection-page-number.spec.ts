import { expect, test, type Page } from "@playwright/test";
import { gotoNotebook, useBujo, WHATS_NEW_NEWEST } from "./harness.ts";

const app = useBujo();

test.beforeEach(async ({ page }) => {
  await app.signIn(page);
  await page.addInitScript(() => sessionStorage.setItem("ak-install-prompt-dismissed", "1"));
  await page.request.put(`${app.baseUrl}/api/whats-new/seen`, { data: { id: WHATS_NEW_NEWEST } });
});

/** Names of the index rows, top to bottom. */
async function order(page: Page): Promise<string[]> {
  return page.getByTestId("collection-row").locator(".collection-row-name").allTextContents();
}

const rowOf = (page: Page, name: string) => page.getByTestId("collection-row").filter({ hasText: name });

/** Opens a collection page from the index and the page number sheet on it. */
async function openSheet(page: Page, name: string): Promise<void> {
  await rowOf(page, name).click();
  await expect(page.getByTestId("collection-title")).toHaveText(name);
  await page.getByTestId("collection-page-open").click();
  await expect(page.getByTestId("collection-page-sheet")).toBeVisible();
}

test("a collection gets a notebook page number: shown in the header and the index, which is re-sorted; clearing removes it; a bad number saves nothing", async ({ page }) => {
  // Created in the opposite order of their numbers: "late" (page 40) first, "early" (page 7) second, "plain" without a number last.
  for (const name of ["late", "early", "plain"]) await page.request.post(`${app.baseUrl}/api/collections`, { data: { name } });
  await gotoNotebook(page, app.baseUrl);
  await expect(page.getByTestId("collection-index")).toBeVisible();
  expect(await order(page)).toEqual(["late", "early", "plain"]);
  await expect(page.getByTestId("collection-row-page")).toHaveCount(0);

  await openSheet(page, "late");
  await page.getByTestId("collection-page-input").fill("40");
  await page.locator("[data-action=save-page]").click();
  await expect(page.getByTestId("collection-page-sheet")).toHaveCount(0);
  await expect(page.getByTestId("collection-page-mark")).toHaveText("p. 40");
  await page.locator("[data-action=collection-back]").click();
  await openSheet(page, "early");
  await page.getByTestId("collection-page-input").fill("7");
  await page.getByTestId("collection-page-input").press("Enter");
  await expect(page.getByTestId("collection-page-mark")).toHaveText("p. 7");

  await page.locator("[data-action=collection-back]").click();
  await expect(page.getByTestId("collection-index")).toBeVisible();
  await expect.poll(() => order(page)).toEqual(["early", "late", "plain"]);
  await expect(rowOf(page, "early").getByTestId("collection-row-page")).toHaveText("p. 7");
  await expect(rowOf(page, "late").getByTestId("collection-row-page")).toHaveText("p. 40");
  await expect(rowOf(page, "plain").getByTestId("collection-row-page")).toHaveCount(0);

  // Change a number: "late" moves to page 3 and now leads the index.
  await openSheet(page, "late");
  await expect(page.getByTestId("collection-page-input")).toHaveValue("40");
  await page.getByTestId("collection-page-input").fill("3");
  await page.locator("[data-action=save-page]").click();
  await expect(page.getByTestId("collection-page-mark")).toHaveText("p. 3");
  await page.locator("[data-action=collection-back]").click();
  await expect.poll(() => order(page)).toEqual(["late", "early", "plain"]);

  // A bad number is refused on the client and nothing is saved.
  await openSheet(page, "plain");
  for (const bad of ["0", "1.5", "abc", "-5"]) {
    await page.getByTestId("collection-page-input").fill(bad);
    await page.locator("[data-action=save-page]").click();
    await expect(page.getByTestId("collection-note")).toHaveText("Use a whole number from 1 to 9999.");
  }
  await expect(page.getByTestId("collection-page-mark")).toHaveCount(0);
  const kept = await (await page.request.get(`${app.baseUrl}/api/collections`)).json();
  expect(kept.collections.map((c: { name: string; paperPage: number | null }) => [c.name, c.paperPage])).toEqual([["late", 3], ["early", 7], ["plain", null]]);

  // Clear a number: the mark goes from the header and the row.
  await page.getByTestId("collection-overlay").click({ position: { x: 4, y: 4 } });
  await page.locator("[data-action=collection-back]").click();
  await openSheet(page, "late");
  await page.getByTestId("collection-page-clear").click();
  await expect(page.getByTestId("collection-page-sheet")).toHaveCount(0);
  await expect(page.getByTestId("collection-page-mark")).toHaveCount(0);
  await page.locator("[data-action=collection-back]").click();
  await expect.poll(() => order(page)).toEqual(["early", "late", "plain"]);
  await expect(rowOf(page, "late").getByTestId("collection-row-page")).toHaveCount(0);
});

test("a server refusal of the page number shows its text in the sheet", async ({ page }) => {
  await page.request.post(`${app.baseUrl}/api/collections`, { data: { name: "films" } });
  await gotoNotebook(page, app.baseUrl);
  await openSheet(page, "films");
  await page.route("**/api/collections/*", (route) => route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "paperPage must be null or a whole number from 1 to 9999" }) }));
  await page.getByTestId("collection-page-input").fill("12");
  await page.locator("[data-action=save-page]").click();
  await expect(page.getByTestId("collection-note")).toHaveText("paperPage must be null or a whole number from 1 to 9999");
});
