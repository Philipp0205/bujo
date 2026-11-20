import http from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "@playwright/test";
import { createApp } from "../../src/app.ts";
import { loadCalDavConfig } from "../../src/caldav/config.ts";
import { caldavSource } from "../../src/caldav/source.ts";
import { fakeEnv, startFakeCalDav, type FakeCalDav } from "../fake-caldav.ts";

export type Harness = { baseUrl: string; fake: FakeCalDav };

/**
 * Starts a fake CalDAV server and the app on random 127.0.0.1 ports for one spec file.
 * Never reaches a real Nextcloud: the only CalDAV server is the fake one.
 * The browser, viewport and color scheme come from the Playwright project (playwright.config.ts).
 */
export function useBujo(options: { failCalDav?: number } = {}): Harness {
  const ctx: Partial<Harness> & { server?: http.Server } = {};
  test.beforeAll(async () => {
    const fake = await startFakeCalDav(options.failCalDav ? { failWith: options.failCalDav } : {});
    const config = loadCalDavConfig(fakeEnv(fake))!;
    const server = http.createServer(createApp({ source: caldavSource(config) }));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    ctx.fake = fake;
    ctx.server = server;
    ctx.baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  test.afterAll(async () => {
    ctx.server?.closeAllConnections?.();
    await new Promise<void>((resolve) => (ctx.server ? ctx.server.close(() => resolve()) : resolve()));
    await ctx.fake?.close();
  });
  return {
    get baseUrl() {
      return ctx.baseUrl!;
    },
    get fake() {
      return ctx.fake!;
    },
  };
}
