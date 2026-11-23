import { defineConfig } from "@playwright/test";

// Screenshots of changed screens. Shot files are test/ui/*.shot.ts (gitignored) and reuse test/ui/harness.ts.
// One phone project at 390x844 with deviceScaleFactor 3. Light and dark are chosen in the shot file, not by a second project.
const phone = {
  channel: "chrome",
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  serviceWorkers: "block",
} as const;

export default defineConfig({
  testDir: "./test/ui",
  testMatch: "*.shot.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: [["list"]],
  projects: [
    { name: "phone", use: phone },
  ],
});
