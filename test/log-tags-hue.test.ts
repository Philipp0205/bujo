import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

type Pill = { kind: string; text: string; hue?: string };
type Entry = { tags?: string[]; time?: string; queued?: boolean; sync?: string; type?: string };

type Log = {
  tags: { HUES: string[]; hueOf: (tag: string) => string };
  days: { entryPills: (entry: Entry) => Pill[]; editPills: (line: { date: string; home: string; tags: string[]; time?: string }) => Pill[] };
};

/** The browser modules, loaded the way a page loads them: scripts that hang themselves on one window.BujoLog. */
function load(): Log {
  const window: { BujoLog?: Log } = {};
  for (const file of ["copy.js", "tags.js", "days.js"]) {
    vm.runInNewContext(readFileSync(new URL(`../public/js/log/${file}`, import.meta.url), "utf8"), { window });
  }
  return window.BujoLog!;
}

const L = load();

test("hueOf: a tag always gets the same pen colour, from the tag hues", () => {
  for (const tag of ["haushalt", "einkauf", "büro", "x", "a very long tag with spaces"]) {
    assert.equal(L.tags.hueOf(tag), L.tags.hueOf(tag));
    assert.ok(L.tags.HUES.includes(L.tags.hueOf(tag)), `${tag} has a known hue`);
  }
});

test("hueOf: the case and the spaces around a word do not change its colour", () => {
  assert.equal(L.tags.hueOf("Haushalt"), L.tags.hueOf("haushalt"));
  assert.equal(L.tags.hueOf("  BÜRO "), L.tags.hueOf("büro"));
});

test("hueOf: time's ochre is not one of the tag hues, and the tag hues are all in use", () => {
  assert.equal(L.tags.HUES.includes("ochre"), false);
  const used = new Set<string>();
  for (let i = 0; i < 200; i++) used.add(L.tags.hueOf("tag" + i));
  assert.equal(used.size, L.tags.HUES.length);
});

test("entryPills: tags carry their hue, the time is ochre, the quiet words carry none", () => {
  const pills = L.days.entryPills({ tags: ["Haushalt", "einkauf"], time: "09:00", type: "task", sync: "synced" });
  assert.deepEqual(JSON.parse(JSON.stringify(pills)), [
    { kind: "tag", text: "Haushalt", hue: L.tags.hueOf("haushalt") },
    { kind: "tag", text: "einkauf", hue: L.tags.hueOf("einkauf") },
    { kind: "time", text: "09:00", hue: "ochre" },
  ]);
  const queued = L.days.entryPills({ queued: true, type: "task" });
  assert.equal(queued.length, 1);
  assert.equal(queued[0].kind, "queued");
  assert.equal(queued[0].hue, undefined);
  const local = L.days.entryPills({ type: "task", sync: "local" });
  assert.equal(local[0].kind, "local");
  assert.equal(local[0].hue, undefined);
});

test("editPills: the chips of a line being edited get the same hues", () => {
  const pills = L.days.editPills({ date: "2026-11-22", home: "2026-11-22", tags: ["Büro"], time: "14:30" });
  assert.deepEqual(JSON.parse(JSON.stringify(pills)), [
    { kind: "tag", text: "Büro", hue: L.tags.hueOf("büro") },
    { kind: "time", text: "14:30", hue: "ochre" },
  ]);
});
