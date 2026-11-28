import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { PUBLIC_DIR } from "../src/app.ts";

type State = { enabled: boolean; reducedMotion: boolean; hidden: boolean; canVibrate: boolean };
type Plan = { haptic: number; sound: string | null };
type Feel = {
  model: { KEY: string; KINDS: string[]; parse: (raw: unknown) => boolean; serialize: (on: boolean) => string; plan: (state: State, kind: string) => Plan };
  jitterModel: { MAX_ROT: number; MAX_Y: number; jitter: (id: string) => { rot: number; y: number } };
};

/** The browser files, loaded the way a page loads them: scripts that hang themselves on window.BujoLog. */
function load(): Feel {
  const window: { BujoLog?: { feel: Feel } } = {};
  for (const file of ["model.js", "jitter-model.js"]) {
    vm.runInNewContext(fs.readFileSync(path.join(PUBLIC_DIR, "js/log/feel", file), "utf8"), { window, Math, Object, String });
  }
  return window.BujoLog!.feel;
}

/** Plain objects from the page's realm, so deepEqual compares them by value. */
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

const loaded = load();
const feel: Feel = {
  model: { ...loaded.model, plan: (state, kind) => plain(loaded.model.plan(state, kind)) },
  jitterModel: { ...loaded.jitterModel, jitter: (id) => plain(loaded.jitterModel.jitter(id)) },
};
const ON: State = { enabled: true, reducedMotion: false, hidden: false, canVibrate: true };

test("feedback is off unless the saved word is on", () => {
  for (const raw of [null, undefined, "", "off", "true", "1", "ON"]) assert.equal(feel.model.parse(raw), false, String(raw));
  assert.equal(feel.model.parse("on"), true);
  assert.equal(feel.model.parse(feel.model.serialize(true)), true);
  assert.equal(feel.model.parse(feel.model.serialize(false)), false);
});

test("a cue does nothing while the switch is off", () => {
  for (const kind of feel.model.KINDS) assert.deepEqual(feel.model.plan({ ...ON, enabled: false }, kind), { haptic: 0, sound: null }, kind);
});

test("a cue ticks and sounds once the switch is on", () => {
  assert.deepEqual(feel.model.plan(ON, "check"), { haptic: 10, sound: "tick" });
  assert.deepEqual(feel.model.plan(ON, "turn"), { haptic: 8, sound: "rustle" });
  assert.deepEqual(feel.model.plan(ON, "lock"), { haptic: 10, sound: null });
});

test("a short tick stays between 8 and 12 ms", () => {
  for (const kind of feel.model.KINDS) {
    const { haptic } = feel.model.plan(ON, kind);
    assert.ok(haptic >= 8 && haptic <= 12, `${kind} ${haptic}`);
  }
});

test("no sound with reduced motion, nothing at all when the page is hidden", () => {
  for (const kind of feel.model.KINDS) {
    assert.equal(feel.model.plan({ ...ON, reducedMotion: true }, kind).sound, null, kind);
    assert.deepEqual(feel.model.plan({ ...ON, hidden: true }, kind), { haptic: 0, sound: null }, kind);
  }
});

test("no tick where the device cannot vibrate, and an unknown cue is silent", () => {
  assert.equal(feel.model.plan({ ...ON, canVibrate: false }, "check").haptic, 0);
  assert.equal(feel.model.plan({ ...ON, canVibrate: false }, "check").sound, "tick");
  assert.deepEqual(feel.model.plan(ON, "nope"), { haptic: 0, sound: null });
});

test("the same id always gets the same tilt and lift", () => {
  for (const id of ["a", "entry-1", "3f2c9e10-aaaa-bbbb-cccc-123456789abc"]) assert.deepEqual(feel.jitterModel.jitter(id), feel.jitterModel.jitter(id));
});

test("the tilt stays within 0.6 degrees and the lift within 0.8 px", () => {
  for (let index = 0; index < 500; index++) {
    const { rot, y } = feel.jitterModel.jitter(`id-${index}`);
    assert.ok(Math.abs(rot) <= 0.6, `rot ${rot}`);
    assert.ok(Math.abs(y) <= 0.8, `y ${y}`);
  }
});

test("different ids differ, and the values use both signs", () => {
  const seen = new Set<string>();
  const rots: number[] = [];
  for (let index = 0; index < 100; index++) {
    const { rot, y } = feel.jitterModel.jitter(`id-${index}`);
    seen.add(`${rot}/${y}`);
    rots.push(rot);
  }
  assert.ok(seen.size > 90, `distinct pairs ${seen.size}`);
  assert.ok(rots.some((rot) => rot < 0) && rots.some((rot) => rot > 0));
  assert.notDeepEqual(feel.jitterModel.jitter("a"), feel.jitterModel.jitter("b"));
});

/** WCAG 2 relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test("the pencil reaches 4.5:1 on the paper and on the sheet in both schemes, and the blocks agree", () => {
  const source = fs.readFileSync(path.join(PUBLIC_DIR, "css/paper-details.css"), "utf8");
  const pencils = [...source.matchAll(/--pencil:\s*(#[0-9a-fA-F]{6})/g)].map((match) => match[1]);
  assert.deepEqual(pencils, ["#a39b8d", "#5e584d", "#5e584d", "#a39b8d"]);
  const [dark, light] = pencils;
  for (const bg of ["#16130f", "#241f1a"]) assert.ok(ratio(dark, bg) >= 4.5, `dark on ${bg} ${ratio(dark, bg)}`);
  for (const bg of ["#f4efe4", "#fbf7f0"]) assert.ok(ratio(light, bg) >= 4.5, `light on ${bg} ${ratio(light, bg)}`);
});
