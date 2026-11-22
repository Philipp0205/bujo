import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { PUBLIC_DIR } from "../src/app.ts";

type Tokens = Record<string, string>;

const css = (file: string) => fs.readFileSync(path.join(PUBLIC_DIR, "css", file), "utf8");

/** The custom properties declared in the body of a rule, for the first rule whose selector line is exactly `selector`. */
function declared(source: string, selector: string, within?: string): Tokens {
  const scope = within ? source.slice(source.indexOf(within)) : source;
  const start = scope.indexOf(`${selector} {`);
  assert.ok(start >= 0, `rule ${selector} found`);
  const end = scope.indexOf("}", start);
  const tokens: Tokens = {};
  for (const match of scope.slice(start, end).matchAll(/(--[a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) tokens[match[1]] = match[2];
  return tokens;
}

/** The four places a scheme is declared: dark default, light OS preference, forced light, forced dark. Each file repeats them. */
function schemes(file: string): Record<"root" | "osLight" | "light" | "dark", Tokens> {
  const source = css(file);
  return {
    root: declared(source, ":root"),
    osLight: declared(source, "  :root", "@media (prefers-color-scheme: light)"),
    light: declared(source, 'html[data-ak-scheme="light"]'),
    dark: declared(source, 'html[data-ak-scheme="dark"]'),
  };
}

/** WCAG 2 relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio of two colours. */
function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const AA = 4.5;
const paper = schemes("paper.css");
const hues = schemes("ink-script.css");

/** Every ink the page writes with. Handwritten tags are about 18px, so they are held to 4.5, not the 3 of large text. */
const PAPER_INKS = ["--paper-ink", "--paper-muted", "--paper-done", "--paper-today", "--pen", "--ink-sage", "--ink-ochre", "--ink-brick", "--ink-gray"];
const HUES = ["--hue-sage", "--hue-sky", "--hue-leaf", "--hue-clay", "--hue-brick", "--hue-ochre", "--hue-mute"];

for (const [name, tokens] of Object.entries(paper)) {
  test(`paper inks reach 4.5:1 on the paper (${name} block)`, () => {
    const bg = name === "root" || name === "dark" ? paper.dark["--paper-bg"] : paper.light["--paper-bg"];
    for (const token of PAPER_INKS) {
      assert.ok(tokens[token], `${token} is declared in the ${name} block`);
      assert.ok(ratio(tokens[token], bg) >= AA, `${token} ${tokens[token]} on ${bg} is ${ratio(tokens[token], bg).toFixed(2)}`);
    }
  });
}

for (const [name, tokens] of Object.entries(hues)) {
  test(`tag hues reach 4.5:1 on the paper (${name} block)`, () => {
    const bg = name === "root" || name === "dark" ? paper.dark["--paper-bg"] : paper.light["--paper-bg"];
    for (const token of HUES) {
      assert.ok(tokens[token], `${token} is declared in the ${name} block`);
      assert.ok(ratio(tokens[token], bg) >= AA, `${token} ${tokens[token]} on ${bg} is ${ratio(tokens[token], bg).toFixed(2)}`);
    }
  });
}

test("each scheme is declared the same in every block that repeats it", () => {
  assert.deepEqual(paper.root, paper.dark, "the dark default and the forced dark agree");
  assert.deepEqual(paper.osLight, { ...paper.light }, "the light OS preference and the forced light agree");
  assert.deepEqual(hues.root, hues.dark);
  assert.deepEqual(hues.osLight, hues.light);
});

test("the dots stay quiet: fainter than any ink, and the paper stays warm, never white or black", () => {
  for (const [dots, bg] of [[paper.dark, paper.dark], [paper.light, paper.light]] as const) {
    assert.ok(ratio(dots["--paper-dot"], bg["--paper-bg"]) < 1.6, "a dot is a hint, not a mark");
    assert.ok(ratio(dots["--paper-dot"], bg["--paper-bg"]) > 1.1, "a dot is still visible");
  }
  assert.ok(ratio(paper.light["--paper-ink"], paper.light["--paper-bg"]) < 18, "light body ink is not stark black on white");
  assert.ok(ratio(paper.dark["--paper-ink"], paper.dark["--paper-bg"]) < 18, "dark body ink is not stark white on black");
  assert.notEqual(paper.light["--paper-bg"].toLowerCase(), "#ffffff");
  assert.notEqual(paper.dark["--paper-bg"].toLowerCase(), "#000000");
});
