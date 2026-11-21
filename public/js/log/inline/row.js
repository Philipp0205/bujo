/*
 * The content of the edit sheet: the type symbol, the title field (a wrapping textarea), the chips (day, tag, time) and a short error line.
 * Needs ak-dom.js, copy.js, glyph.js, days.js. It is built once and patched after that, so the input keeps its focus
 * and the keyboard stays up. It builds and patches nodes, it never saves anything.
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};
  L.inline = L.inline || {};

  /** The glyph slot of the sheet, showing the line's type. */
  function symbol(type) {
    return h('span', { class: 'paper-sym', role: 'img', 'aria-label': L.copy.typeLabels[type] }, L.glyph.typeGlyph(type));
  }

  /** Makes the field as tall as its wrapped text, up to the CSS max-height, and scrolls inside it only past that. */
  function grow(input) {
    input.style.height = 'auto';
    var max = parseFloat(window.getComputedStyle(input).maxHeight) || Infinity;
    input.style.height = Math.min(input.scrollHeight, max) + 'px';
    input.style.overflowY = input.scrollHeight > max ? 'auto' : 'hidden';
  }

  /** Titles are one line of plain text on the server, so a typed or pasted line break (any control character) becomes a space. */
  function flatten(input) {
    var flat = input.value.replace(/[\u0000-\u001f\u007f]/g, ' ');
    if (flat === input.value) return;
    var start = input.selectionStart;
    var end = input.selectionEnd;
    input.value = flat;
    input.setSelectionRange(start, end);
  }

  /** Sets the text of the field from code and sizes the field to it. */
  function setTitle(input, value) {
    input.value = value;
    grow(input);
  }

  /** The text field of the line, a wrapping textarea that grows with its text. onType(value, composing) runs on every keystroke. */
  function titleInput(onType) {
    var input = h('textarea', {
      class: 'paper-edit-input',
      rows: 1,
      name: 'title',
      maxlength: 200,
      autocomplete: 'off',
      autocapitalize: 'sentences',
      enterkeyhint: 'enter',
      'aria-label': L.copy.inline.titleLabel
    });
    input.addEventListener('input', function (event) {
      flatten(input);
      grow(input);
      onType(input.value, !!event.isComposing);
    });
    input.addEventListener('compositionend', function () { onType(input.value, false); });
    return input;
  }

  /** The error line under the chips, or null when there is nothing to say. */
  function errorLine(line) {
    return line.error ? h('p', { class: 'paper-line-error', role: 'alert' }, line.error) : null;
  }

  /** The editing line: symbol and input on one baseline, then the chips. Built once for the sheet. */
  function build(onType) {
    var row = h('div', { class: 'paper-edit', 'data-type': 'task', 'data-indent': '0' },
      symbol('task'),
      h('span', { class: 'paper-body' }, titleInput(onType)));
    return h('div', { class: 'paper-line', 'data-editing': '', 'data-new': 'true' }, row, h('div', { class: 'sheet-chips' }));
  }

  /** Patches the chips of the line: its day (when moved), tag and time. */
  function patchChips(node, line) {
    var chips = node.querySelector('.sheet-chips');
    chips.replaceChildren.apply(chips, L.days.editPills(line).map(L.glyph.pill));
    L.ink.decorate.chips(node);
  }

  /** Patches the error line: the old one goes, a new one comes when the line has an error. */
  function patchError(node, line) {
    var old = node.querySelector('.paper-line-error');
    var next = errorLine(line);
    if (old) old.remove();
    if (next) node.appendChild(next);
  }

  /** Patches the live line after a bar change or an error: glyph, chips, indent and error, without touching the input. */
  function update(line) {
    var node = document.querySelector('.paper-line');
    if (!node) return;
    var row = node.querySelector('.paper-edit');
    node.setAttribute('data-new', line.isNew ? 'true' : 'false');
    row.setAttribute('data-type', line.type);
    row.setAttribute('data-indent', String(line.indent));
    if (line.id) row.setAttribute('data-id', line.id);
    else row.removeAttribute('data-id');
    row.replaceChild(symbol(line.type), row.querySelector('.paper-sym'));
    patchChips(node, line);
    patchError(node, line);
  }

  L.inline.row = { build: build, update: update, setTitle: setTitle, grow: grow };
})();
