import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

type Marker = { state: string; typeChanged: boolean };
type Item = { status: string; include: boolean; movedFrom?: unknown; before?: { type: string } | null; after?: { type: string } | null };

/** The real scan model in a page-like sandbox. */
function load(): { markerOf(item: Item): Marker } {
  const window: { BujoLog: { scan?: { model: { markerOf(item: Item): Marker } } } } = { BujoLog: {} };
  const context = vm.createContext({ window, String, Math, Number, Array, Object, RegExp, Date, Blob: class {} });
  vm.runInContext(readFileSync(new URL("../public/js/log/scan/model.js", import.meta.url), "utf8"), context);
  return window.BujoLog.scan!.model;
}

const { markerOf } = load();
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));

test("an unchanged line is matched, whether or not it is ticked", () => {
  assert.deepEqual(plain(markerOf({ status: "unchanged", include: false })), { state: "matched", typeChanged: false });
  assert.equal(markerOf({ status: "unchanged", include: true }).state, "matched");
});

test("a kept new line is new, a kept edited line is updated", () => {
  assert.equal(markerOf({ status: "new", include: true }).state, "new");
  assert.equal(markerOf({ status: "edited", include: true }).state, "updated");
  assert.equal(markerOf({ status: "new", include: true, movedFrom: { date: "2026-11-01" } }).state, "updated");
});

test("an unticked new or edited line is skipped", () => {
  assert.equal(markerOf({ status: "new", include: false }).state, "skipped");
  assert.deepEqual(plain(markerOf({ status: "edited", include: false, before: { type: "task" }, after: { type: "done" } })), { state: "skipped", typeChanged: false });
});

test("an updated line whose type differs from the entry's has its type changed", () => {
  assert.deepEqual(plain(markerOf({ status: "edited", include: true, before: { type: "task" }, after: { type: "migrated" } })), { state: "updated", typeChanged: true });
  assert.equal(markerOf({ status: "edited", include: true, before: { type: "task" }, after: { type: "task" } }).typeChanged, false);
  assert.equal(markerOf({ status: "new", include: true }).typeChanged, false);
});
