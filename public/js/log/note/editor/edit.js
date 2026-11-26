/*
 * Pure text edits of the note editor. Each takes { value, start, end } (the textarea text and selection) and returns the same shape,
 * or null when the edit does not apply. No DOM, no strings to show (placeholders come from the caller).
 * Rules: heading cycles none, "# ", "## ", none. List toggles a "- " prefix. Checkbox turns a plain line or bullet into "- [ ] " and
 * any checkbox line back into a plain line. Indent adds two spaces to a list line, outdent takes up to two (or a tab) off.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.note = L.note || {};
  L.note.editor = L.note.editor || {};

  var LIST = /^(\s*)([-*]|(\d+)\.) (\[[ xX]\] )?/;
  var INDENT = '  ';

  /** Index where the line holding position i starts. */
  function lineStart(value, i) {
    return i === 0 ? 0 : value.lastIndexOf('\n', i - 1) + 1;
  }

  /** Index where the line holding position i ends (before its newline). */
  function lineEnd(value, i) {
    var at = value.indexOf('\n', i);
    return at === -1 ? value.length : at;
  }

  /** Runs fn on each line the selection touches, then moves the selection by the length changes. fn returns the new line. */
  function mapLines(state, fn) {
    var v = state.value;
    var last = state.end > state.start && v.charAt(state.end - 1) === '\n' ? state.end - 1 : state.end;
    var from = lineStart(v, state.start);
    var lines = v.slice(from, lineEnd(v, last)).split('\n');
    var next = lines.map(fn);
    var firstDelta = next[0].length - lines[0].length;
    var total = next.join('\n').length - lines.join('\n').length;
    if (next.join('\n') === lines.join('\n')) return null;
    var start = Math.max(from, state.start + firstDelta);
    return {
      value: v.slice(0, from) + next.join('\n') + v.slice(lineEnd(v, last)),
      start: start,
      end: Math.max(start, state.end + total)
    };
  }

  /** Wraps the selection in a mark, or inserts mark + placeholder + mark and selects the placeholder. */
  function wrap(state, mark, placeholder) {
    var v = state.value;
    var text = v.slice(state.start, state.end) || placeholder;
    var start = state.start + mark.length;
    return { value: v.slice(0, state.start) + mark + text + mark + v.slice(state.end), start: start, end: start + text.length };
  }

  /** Makes [text](url). With a selection the url placeholder is selected next; with none the text placeholder is. */
  function link(state, textPlaceholder, urlPlaceholder) {
    var v = state.value;
    var selected = v.slice(state.start, state.end);
    var text = selected || textPlaceholder;
    var out = '[' + text + '](' + urlPlaceholder + ')';
    var start = state.start + 1 + (selected ? text.length + 2 : 0);
    var length = selected ? urlPlaceholder.length : text.length;
    return { value: v.slice(0, state.start) + out + v.slice(state.end), start: start, end: start + length };
  }

  /** Heading cycle on a line: plain to "# ", "# " to "## ", anything deeper or "## " back to plain. */
  function headingLine(line) {
    var match = /^(#{1,6}) /.exec(line);
    if (!match) return '# ' + line;
    return match[1].length === 1 ? '#' + line : line.slice(match[0].length);
  }

  /** Toggles the heading of the selected lines. */
  function heading(state) {
    return mapLines(state, headingLine);
  }

  /** List toggle on a line: a list prefix (bullet, number or checkbox) comes off, a plain line gets "- ". */
  function listLine(line) {
    var match = LIST.exec(line);
    return match ? match[1] + line.slice(match[0].length) : '- ' + line;
  }

  /** Toggles a "- " list prefix on the selected lines. */
  function list(state) {
    return mapLines(state, listLine);
  }

  /** Checkbox toggle on a line: a checkbox line becomes plain, a bullet gains a box, a plain line becomes "- [ ] ". */
  function checkboxLine(line) {
    var match = LIST.exec(line);
    if (!match) return '- [ ] ' + line;
    if (match[4]) return match[1] + line.slice(match[0].length);
    return match[1] + '- [ ] ' + line.slice(match[0].length);
  }

  /** Toggles a "- [ ] " checkbox on the selected lines. */
  function checkbox(state) {
    return mapLines(state, checkboxLine);
  }

  /** Indents (or with out set, outdents) the list lines of the selection. Other lines stay as they are. */
  function indent(state, out) {
    return mapLines(state, function (line) {
      if (!LIST.test(line)) return line;
      if (!out) return INDENT + line;
      return line.replace(/^( {1,2}|\t)/, '');
    });
  }

  /** Enter in a list item: starts the next item of the same kind, or on an empty item removes it and ends the list. Null elsewhere. */
  function enter(state) {
    if (state.start !== state.end) return null;
    var v = state.value;
    var from = lineStart(v, state.start);
    var line = v.slice(from, lineEnd(v, state.start));
    var match = LIST.exec(line);
    if (!match || state.start - from < match[0].length) return null;
    if (line.slice(match[0].length).trim() === '') {
      return { value: v.slice(0, from) + v.slice(from + line.length), start: from, end: from };
    }
    var marker = match[3] ? (Number(match[3]) + 1) + '.' : match[2];
    var insert = '\n' + match[1] + marker + ' ' + (match[4] ? '[ ] ' : '');
    var at = state.start + insert.length;
    return { value: v.slice(0, state.start) + insert + v.slice(state.start), start: at, end: at };
  }

  L.note.editor.edit = { wrap: wrap, link: link, heading: heading, list: list, checkbox: checkbox, indent: indent, enter: enter };
})();
