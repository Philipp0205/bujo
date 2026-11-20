import { defineConfig } from "@playwright/test";

// Each spec file gets its own app and fake CalDAV server on random 127.0.0.1 ports (see test/ui/harness.ts).
// The two projects run the same specs on a 390x844 phone, once per system color scheme, in the system Chrome.
const phone = {
  channel: "chrome",
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  serviceWorkers: "block",
} as const;

export default defineConfig({
  testDir: "./test/ui",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  workers: 2,
  retries: 0,
  timeout: 30_000,
  reporter: [["list"]],
  projects: [
    { name: "phone-light", use: { ...phone, colorScheme: "light" } },
    { name: "phone-dark", use: { ...phone, colorScheme: "dark" } },
  ],
});
