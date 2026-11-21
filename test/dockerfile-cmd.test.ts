import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const dockerfile = fs.readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
// Column 0 only: the indented "CMD" in the HEALTHCHECK continuation line is not the container command.
const cmdLines = dockerfile.split("\n").filter((line) => /^CMD\b/i.test(line));

test("the app Dockerfile has exactly one CMD", () => {
  assert.equal(cmdLines.length, 1);
});

test("the CMD does not start the app through a package manager, so SIGTERM reaches the app", () => {
  assert.doesNotMatch(cmdLines[0], /\b(npm|npx|yarn|pnpm)\b/i);
});
