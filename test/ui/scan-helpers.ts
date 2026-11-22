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
