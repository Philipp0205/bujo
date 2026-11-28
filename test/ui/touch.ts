import type { Page } from "@playwright/test";

/** A finger driven through the browser's touch input (CDP), so a press, a hold and a drag reach the page as real touch events. */
export type Finger = {
  down(x: number, y: number): Promise<void>;
  /** Moves to (x, y) in `steps` small steps, `pause` ms apart. */
  move(x: number, y: number, steps?: number, pause?: number): Promise<void>;
  up(): Promise<void>;
};

/** Opens a finger on a page. One finger, from the last down to the next up. */
export async function finger(page: Page): Promise<Finger> {
  const session = await page.context().newCDPSession(page);
  let at = { x: 0, y: 0 };
  const send = (type: "touchStart" | "touchMove" | "touchEnd", touchPoints: Array<{ x: number; y: number }>) =>
    session.send("Input.dispatchTouchEvent", { type, touchPoints });
  return {
    async down(x, y) {
      at = { x, y };
      await send("touchStart", [at]);
    },
    async move(x, y, steps = 6, pause = 16) {
      const from = at;
      for (let step = 1; step <= steps; step++) {
        at = { x: from.x + ((x - from.x) * step) / steps, y: from.y + ((y - from.y) * step) / steps };
        await send("touchMove", [at]);
        if (pause) await page.waitForTimeout(pause);
      }
    },
    async up() {
      await send("touchEnd", []);
    },
  };
}
