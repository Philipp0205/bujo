import type { FileChooser, Page } from "@playwright/test";

/** The Scan tab of the bottom bar. */
export const scanTab = (page: Page) => page.getByRole("navigation", { name: "Main" }).locator("[data-tab=scan]");

/**
 * Taps Scan in the bar. The tab opens the camera screen and clicks the camera input at once, so a file chooser always fires.
 * It is returned: a test that wants to send a camera photo calls setFiles on it, any other test just ignores it, so none hangs on it.
 */
export async function openScan(page: Page): Promise<FileChooser> {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), scanTab(page).click()]);
  return chooser;
}
