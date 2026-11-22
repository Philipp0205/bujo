import type { FileChooser, Page } from "@playwright/test";

/** The camera icon in the header of the rapid log. */
export const scanButton = (page: Page) => page.locator(".paper-head [data-action=scan]");

/** The raised Add tab of the bottom bar (it starts a new entry, never a scan). */
export const addTab = (page: Page) => page.getByRole("navigation", { name: "Main" }).locator("[data-tab=add]");

/**
 * Taps the camera icon in the header of the log. The tap opens the camera screen and clicks the camera input at once, so a file chooser always fires.
 * It is returned: a test that wants to send a camera photo calls setFiles on it, any other test just ignores it, so none hangs on it.
 */
export async function openScan(page: Page): Promise<FileChooser> {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), scanButton(page).click()]);
  return chooser;
}
