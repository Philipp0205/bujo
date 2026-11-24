import type { BrowserContext, Page } from "@playwright/test";
import { test } from "@playwright/test";
import { loadCalDavConfig } from "../../src/caldav/config.ts";
import { caldavSource } from "../../src/caldav/source.ts";
import { openDb } from "../../src/db.ts";
import { createOcrClient } from "../../src/scan/ocr-client.ts";
import { createSyncService, type SyncService } from "../../src/sync/service.ts";
import { fakeEnv, startFakeCalDav, SYNC_SETTINGS, syncEnv, type FakeCalDav } from "../fake-caldav.ts";
import { startFakeOcr, type FakeOcr } from "../fake-ocr.ts";
import { startApp, signUp, type TestApp } from "../helpers.ts";

/** The id of the newest what's-new entry. Specs that mark everything as seen use this, so a new entry bumps one line. */
export const WHATS_NEW_NEWEST = "2026-11-23-spacing";

/** Opens the details sheet of a saved row: tap the row to type in it, then Details in the accessory bar. */
export async function openDetails(page: Page, title: string): Promise<void> {
  await page.locator(".paper-row", { hasText: title }).click();
  await page.locator(".inline-bar [data-action=details]").click();
  await page.getByRole("dialog").waitFor();
}

export type Harness = {
  baseUrl: string;
  fake: FakeCalDav;
  /** The fake OCR service the app talks to. It answers a fixed page. */
  ocr: FakeOcr;
  /** The recovery code of the seeded account. Empty when seedUser is false. */
  recoveryCode: string;
  /** The mails the app "sent". Nothing real is ever sent. */
  mailer: TestApp["mailer"];
  /** Puts the seeded account's session cookie into the page's browser context. */
  signIn(target: Page | BrowserContext): Promise<void>;
};

/**
 * Starts a fake CalDAV server and the app on random 127.0.0.1 ports for one spec file, with an in-memory
 * database and the kit's stub mailer. Never reaches a real Nextcloud or a real mail provider.
 * By default one account exists already: call signIn(page) to be signed in. Pass seedUser: false to start
 * with no account at all (first-run sign-up). Pass emailOff: true to start the server without a mailer.
 * The browser, viewport and color scheme come from the Playwright project (playwright.config.ts).
 */
export function useBujo(options: { failCalDav?: number; seedUser?: boolean; emailOff?: boolean; sync?: boolean } = {}): Harness {
  const ctx: { fake?: FakeCalDav; ocr?: FakeOcr; app?: TestApp; sync?: SyncService; cookie?: string; recoveryCode?: string } = {};
  const seed = options.seedUser !== false;
  test.beforeAll(async () => {
    const fake = await startFakeCalDav(options.failCalDav ? { failWith: options.failCalDav } : {});
    const ocr = await startFakeOcr();
    const env = options.sync ? syncEnv(fake) : fakeEnv(fake);
    const db = openDb(":memory:");
    const sync = options.sync
      ? createSyncService({ db, caldav: loadCalDavConfig(env)!, sync: { ...SYNC_SETTINGS }, log: () => undefined })
      : undefined;
    const app = await startApp(caldavSource(loadCalDavConfig(env)!), {
      db,
      sync,
      ocr: createOcrClient(ocr.url),
      ...(options.emailOff ? { mailer: undefined } : {}),
    });
    ctx.fake = fake;
    ctx.ocr = ocr;
    ctx.app = app;
    ctx.sync = sync;
    if (seed) {
      const signed = await signUp(app.base);
      ctx.cookie = signed.cookie;
      ctx.recoveryCode = signed.recoveryCode;
    }
  });
  test.afterAll(async () => {
    // A push still in flight must end before the database closes under it.
    await ctx.sync?.idle();
    await ctx.app?.close();
    await ctx.ocr?.close();
    await ctx.fake?.close();
  });
  return {
    get baseUrl() {
      return ctx.app!.base;
    },
    get fake() {
      return ctx.fake!;
    },
    get ocr() {
      return ctx.ocr!;
    },
    get recoveryCode() {
      return ctx.recoveryCode ?? "";
    },
    get mailer() {
      return ctx.app!.mailer;
    },
    async signIn(target) {
      if (!ctx.cookie) throw new Error("useBujo({ seedUser: false }) has no account to sign in to");
      const context = "context" in target && typeof target.context === "function" ? target.context() : (target as BrowserContext);
      const [name, value] = ctx.cookie.split("=");
      await context.addCookies([{ name, value, url: ctx.app!.base }]);
    },
  };
}
