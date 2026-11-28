import type { FileChooser, Page } from "@playwright/test";

/** The bottom tab bar. */
export const mainBar = (page: Page) => page.getByRole("navigation", { name: "Main" });

/** The camera Scan tab of the bottom bar, right of Add (it starts a scan, it is never the current page). */
export const scanTab = (page: Page) => mainBar(page).locator("[data-tab=scan]");

/** The raised Add tab of the bottom bar (it starts a new entry, never a scan). */
export const addTab = (page: Page) => mainBar(page).locator("[data-tab=add]");

/**
 * Taps the Scan tab of the bottom bar. The tap opens the camera screen and clicks the camera input at once, so a file chooser always fires.
 * It is returned: a test that wants to send a camera photo calls setFiles on it, any other test just ignores it, so none hangs on it.
 */
export async function openScan(page: Page): Promise<FileChooser> {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), scanTab(page).click()]);
  return chooser;
}

/** The type picker on top of the scan review and the note sheet. */
export const picker = (page: Page) => page.getByTestId("scan-picker");

/** One word of the picker: step "type" (Log or Collection), "sub" (Daily, Monthly, Future, list ...), "target" (a page, a month, a range) or "part" (calendar or tasks of a month). */
export type PickStep = "type" | "sub" | "target" | "part";
export const pickStep = (page: Page, step: PickStep) => picker(page).locator(`.scan-pick[data-step="${step}"]`);

/** Opens the popover of a step and taps the choice with this label. */
export async function choose(page: Page, step: PickStep, label: string): Promise<void> {
  await pickStep(page, step).click();
  await picker(page).getByRole("option", { name: label, exact: true }).click();
}

/** Opens the camera screen, then taps its gallery button. The chooser it returns takes several files at once. */
export async function openGallery(page: Page): Promise<FileChooser> {
  await openScan(page);
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.locator("[data-action=gallery]").click()]);
  return chooser;
}
