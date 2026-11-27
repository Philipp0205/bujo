import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { matchKey } from "../src/scan/match.ts";
import { canCarry, carriedFrom, openBefore } from "../src/log/scan/carry.ts";
import { fixedReader, resolveSlots } from "../src/log/scan/plan.ts";
import type { Line } from "../src/log/scan/types.ts";
import type { EntryType, ScanEntry } from "../src/log/types.ts";

const TODAY = "2026-11-25";

/** An entry on a day, a task unless said otherwise. */
function entry(id: string, title: string, date: string, over: Partial<ScanEntry> = {}): ScanEntry {
  const type: EntryType = "task";
  return { id, date, horizon: "day", type, title, tags: [], time: null, body: null, collectionId: null, important: false, hasPhoto: false, indent: 0, sync: "local", syncError: null, position: 0, page: 1, createdAt: 0, updatedAt: 0, onPaper: true, scan: { key: matchKey(title), type, title, tags: [], time: null, at: 0 }, ...over };
}

const line = (id: string, title: string, type: EntryType = "task", over: Partial<Line> = {}): Line => ({ id, type, title, tags: [], time: null, ...over });

test("openBefore keeps open daily tasks of the 14 days before the day, nothing else", () => {
  const all = [
    entry("in", "Post", "2026-11-20"),
    entry("edge", "Post", "2026-11-11"),
    entry("old", "Post", "2026-11-10"),
    entry("same", "Post", TODAY),
    entry("done", "Post", "2026-11-20", { type: "done" }),
    entry("note", "Post", "2026-11-20", { type: "note" }),
    entry("month", "Post", "2026-11-20", { horizon: "month-task" }),
    entry("coll", "Post", "2026-11-20", { collectionId: "c1" }),
  ];
  assert.deepEqual(openBefore(all, TODAY).map((e) => e.id), ["in", "edge"]);
});

test("carriedFrom links a line to the one open task that matches its title", () => {
  const open = [entry("a", "Post abholen", "2026-11-20"), entry("b", "Brot kaufen", "2026-11-21")];
  assert.equal(carriedFrom(line("l1", "Post abholen"), open, new Set())?.id, "a");
  assert.equal(carriedFrom(line("l1", "Zahnarzt"), open, new Set()), undefined);
});

test("carriedFrom links nothing when two open tasks match about equally, or the only match is taken", () => {
  const twins = [entry("a", "Post abholen", "2026-11-20"), entry("b", "Post abholen", "2026-11-21")];
  assert.equal(carriedFrom(line("l1", "Post abholen"), twins, new Set()), undefined);
  assert.equal(carriedFrom(line("l1", "Post abholen"), [twins[0]], new Set(["a"])), undefined);
});

test("canCarry: a task or done line with a title, never an un-matched one or another type", () => {
  assert.equal(canCarry(line("l", "Post")), true);
  assert.equal(canCarry(line("l", "Post", "done")), true);
  assert.equal(canCarry(line("l", "Post", "task", { unmatched: true })), false);
  assert.equal(canCarry(line("l", "Post", "note")), false);
  assert.equal(canCarry(line("l", "Post", "migrated")), false);
  assert.equal(canCarry(line("l", "  ")), false);
});

test("resolveSlots: a new line on a later day carries the open task, each task once, an un-matched line stays plain", () => {
  const reader = fixedReader([entry("a", "Post abholen", "2026-11-20")]);
  const slot = { horizon: "day" as const, date: TODAY };
  const placed = [line("l1", "Post abholen"), line("l2", "Post abholen", "task"), line("l3", "Post abholen", "task", { unmatched: true })].map((l) => ({ line: l, slot }));
  const out = resolveSlots(placed, reader);
  assert.deepEqual(out.get("l1")?.movedFrom, { id: "a", date: "2026-11-20" });
  assert.equal(out.get("l1")?.status, "new");
  assert.equal(out.get("l2")?.movedFrom, undefined);
  assert.equal(out.get("l3")?.movedFrom, undefined);
});

type Item = Record<string, unknown>;

/** Loads the scan model the way the page does and returns its defaultInclude. */
function loadDefaultInclude(): (item: Item) => boolean {
  const window: Record<string, any> = {};
  const dir = path.join(import.meta.dirname, "..", "public", "js", "log");
  for (const file of ["dates.js", "tags.js", path.join("scan", "model.js")]) vm.runInNewContext(fs.readFileSync(path.join(dir, file), "utf8"), { window });
  return window.BujoLog.scan.model.defaultInclude;
}

const edited = (before: EntryType, after: EntryType, contested: boolean): Item => ({
  status: "edited", contested, noBullet: false, title: "Post", before: { type: before, title: "Post", tags: [], time: null }, after: { type: after, title: "Post", tags: [], time: null },
});

test("client defaultInclude: a contested close of an open task starts ticked, any other contested line stays unticked", () => {
  const include = loadDefaultInclude();
  for (const closed of ["migrated", "scheduled", "dropped", "done"] as const) assert.equal(include(edited("task", closed, true)), true, closed);
  assert.equal(include(edited("done", "task", true)), false);
  assert.equal(include(edited("task", "note", true)), false);
  assert.equal(include(edited("task", "task", true)), false);
  assert.equal(include(edited("task", "migrated", false)), true);
});
