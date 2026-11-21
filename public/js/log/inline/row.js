/*
 * The line being typed, as nodes: a task-style row with a text input, the pills (day, tag, time) and a short error line.
 * Needs ak-dom.js, copy.js, glyph.js, days.js. It builds and patches nodes, it never saves anything.
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};
  L.inline = L.inline || {};

  /** The glyph slot of a row, showing the line's type. */
  function symbol(line) {
    return h('span', { class: 'paper-sym', role: 'img', 'aria-label': L.copy.typeLabels[line.type] }, L.glyph.typeGlyph(line.type));
  }

  /** The text input of the line. onType(value, composing) runs on every keystroke so the line always holds the draft. */
  function titleInput(line, onType) {
    var input = h('input', {
      class: 'paper-edit-input',
      type: 'text',
      name: 'title',
      maxlength: 200,
      autocomplete: 'off',
      autocapitalize: 'sentences',
      enterkeyhint: 'enter',
      'aria-label': L.copy.inline.titleLabel,
      value: line.title
    });
    input.addEventListener('input', function (event) { onType(input.value, !!event.isComposing); });
    input.addEventListener('compositionend', function () { onType(input.value, false); });
    return input;
  }

  /** The error line under the input, or null when there is nothing to say. */
  function errorLine(line) {
    return line.error ? h('p', { class: 'paper-line-error', role: 'alert' }, line.error) : null;
  }

  /** The editable row. It is one 24px line, like a saved row, with the input where the title would be. */
  function build(line, onType) {
    var row = h('div', { class: 'paper-row paper-edit', 'data-edit-zone': '', 'data-type': line.type, 'data-id': line.id, 'data-indent': String(line.indent) },
      symbol(line),
      h('span', { class: 'paper-body' },
        titleInput(line, onType),
        h('span', { class: 'paper-meta' }, h('span', { class: 'meta-text' }, L.days.editPills(line)))));
    return h('div', { class: 'paper-line', 'data-editing': '', 'data-new': line.isNew ? 'true' : 'false' }, row, errorLine(line));
  }

  /** Patches the live row after a bar change or an error: glyph, pills, indent and error, without touching the input. */
  function update(line) {
    var node = document.querySelector('.paper-line');
    if (!node) return;
    var row = node.querySelector('.paper-edit');
    row.setAttribute('data-type', line.type);
    row.setAttribute('data-indent', String(line.indent));
    row.replaceChild(symbol(line), row.querySelector('.paper-sym'));
    row.querySelector('.meta-text').textContent = L.days.editPills(line);
    var old = node.querySelector('.paper-line-error');
    var next = errorLine(line);
    if (old) old.remove();
    if (next) node.appendChild(next);
  }

  L.inline.row = { build: build, update: update };
})();
