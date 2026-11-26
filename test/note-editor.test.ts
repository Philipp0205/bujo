import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

type State = { value: string; start: number; end: number };
type Edit = Record<string, (...args: any[]) => State | null>;

/** Loads the pure editor files into a sandbox and returns the renderer and the edit helpers. */
function load(): { render(text: string): string; edit: Edit } {
  const window: Record<string, any> = {};
  for (const file of ["render.js", "edit.js"]) {
    const source = fs.readFileSync(path.join(import.meta.dirname, "..", "public", "js", "log", "note", "editor", file), "utf8");
    vm.runInNewContext(source, { window });
  }
  return { render: window.BujoLog.note.editor.render, edit: window.BujoLog.note.editor.edit };
}

const { render, edit } = load();
const at = (value: string, start = value.length, end = start): State => ({ value, start, end });
const plain = (state: State | null) => (state ? JSON.parse(JSON.stringify(state)) : null);

test("render: escapes script tags and event handler markup", () => {
  const html = render("<script>alert(1)</script>\n<img src=x onerror=alert(1)>");
  assert.ok(!html.includes("<script"));
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
});

test("render: unsafe link schemes never become hrefs, safe ones do", () => {
  for (const url of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,x", "vbscript:x", " java\tscript:alert(1)"]) {
    const html = render(`[click](${url.replace(/ /g, "")})`);
    assert.ok(!html.includes("href"), html);
    assert.ok(html.includes("click"));
  }
  assert.ok(render("[a](https://example.com/x?a=1&b=2)").includes('href="https://example.com/x?a=1&amp;b=2"'));
  assert.ok(render("[a](mailto:me@example.com)").includes('href="mailto:me@example.com"'));
  assert.ok(render("[a](/notes)").includes('href="/notes"'));
  assert.ok(render('[a](https://x.com/"onmouseover="y)').includes("&quot;"));
});

test("render: headings, bold, italic", () => {
  assert.equal(render("# Title"), '<h3 class="md-h1">Title</h3>');
  assert.equal(render("## Sub"), '<h4 class="md-h2">Sub</h4>');
  assert.equal(render("a **bold** and *italic* word"), "<p>a <strong>bold</strong> and <em>italic</em> word</p>");
  assert.ok(!render("2 * 3 * 4").includes("<em>"));
});

test("render: bullet, numbered and checkbox lists", () => {
  assert.equal(render("- one\n* two"), '<ul><li class="md-d0">one</li><li class="md-d0">two</li></ul>');
  assert.equal(render("1. a\n2. b"), '<ol><li class="md-d0">a</li><li class="md-d0">b</li></ol>');
  const tasks = render("- [ ] open\n- [x] done");
  assert.ok(tasks.includes('data-checked="false"'));
  assert.ok(tasks.includes('data-checked="true"'));
  assert.ok(render("- a\n  - b").includes('class="md-d1"'));
});

test("render: paragraphs and line breaks", () => {
  assert.equal(render("one\ntwo\n\nthree"), "<p>one<br>two</p><p>three</p>");
  assert.equal(render("text\n# H\nmore"), '<p>text</p><h3 class="md-h1">H</h3><p>more</p>');
  assert.equal(render(""), "");
});

test("wrap: wraps the selection, or inserts a placeholder and selects it", () => {
  assert.deepEqual(plain(edit.wrap(at("a word b", 2, 6), "**", "bold")), { value: "a **word** b", start: 4, end: 8 });
  assert.deepEqual(plain(edit.wrap(at("ab", 1), "*", "italic")), { value: "a*italic*b", start: 2, end: 8 });
});

test("link: wraps the selection as [text](url) and selects the url", () => {
  assert.deepEqual(plain(edit.link(at("see page", 4, 8), "text", "https://")), { value: "see [page](https://)", start: 11, end: 19 });
  assert.deepEqual(plain(edit.link(at("x", 1), "text", "https://")), { value: "x[text](https://)", start: 2, end: 6 });
});

test("heading: cycles none, #, ##, none on the current line", () => {
  assert.equal(edit.heading(at("one\ntwo", 5))!.value, "one\n# two");
  assert.equal(edit.heading(at("# two", 3))!.value, "## two");
  assert.equal(edit.heading(at("## two", 3))!.value, "two");
  assert.equal(edit.heading(at("### two", 3))!.value, "two");
});

test("list: toggles a - prefix, and removes bullets, numbers and checkboxes", () => {
  assert.equal(edit.list(at("one"))!.value, "- one");
  assert.equal(edit.list(at("- one"))!.value, "one");
  assert.equal(edit.list(at("1. one"))!.value, "one");
  assert.equal(edit.list(at("- [x] one"))!.value, "one");
  assert.equal(edit.list(at("a\nb", 0, 3))!.value, "- a\n- b");
});

test("checkbox: plain and bullet lines gain a box, any checkbox line goes back to plain", () => {
  assert.equal(edit.checkbox(at("one"))!.value, "- [ ] one");
  assert.equal(edit.checkbox(at("- one"))!.value, "- [ ] one");
  assert.equal(edit.checkbox(at("- [ ] one"))!.value, "one");
  assert.equal(edit.checkbox(at("- [x] one"))!.value, "one");
});

test("enter: continues bullets, numbers and checkboxes", () => {
  assert.deepEqual(plain(edit.enter(at("- a"))), { value: "- a\n- ", start: 6, end: 6 });
  assert.equal(edit.enter(at("* a"))!.value, "* a\n* ");
  assert.equal(edit.enter(at("1. a"))!.value, "1. a\n2. ");
  assert.equal(edit.enter(at("- [x] a"))!.value, "- [x] a\n- [ ] ");
  assert.equal(edit.enter(at("  - a"))!.value, "  - a\n  - ");
});

test("enter: an empty item loses its marker; other lines and selections are left to the browser", () => {
  assert.deepEqual(plain(edit.enter(at("- a\n- "))), { value: "- a\n", start: 4, end: 4 });
  assert.equal(edit.enter(at("- [ ] "))!.value, "");
  assert.equal(edit.enter(at("plain")), null);
  assert.equal(edit.enter(at("- a", 0, 3)), null);
  assert.equal(edit.enter(at("- a", 1)), null);
});

test("indent and outdent: two spaces on list lines only", () => {
  assert.deepEqual(plain(edit.indent(at("- a"), false)), { value: "  - a", start: 5, end: 5 });
  assert.equal(edit.indent(at("plain"), false), null);
  assert.equal(edit.indent(at("  - a"), true)!.value, "- a");
  assert.equal(edit.indent(at("\t- a"), true)!.value, "- a");
  assert.equal(edit.indent(at("- a"), true), null);
  assert.equal(edit.indent(at("- a\n- b", 0, 7), false)!.value, "  - a\n  - b");
});
