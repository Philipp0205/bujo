/*
 * The content of the edit sheet: the type symbol, the title input, the chips (day, tag, time) and a short error line.
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

  /** The text input of the line. onType(value, composing) runs on every keystroke so the line always holds the draft. */
  function titleInput(onType) {
    var input = h('input', {
      class: 'paper-edit-input',
      type: 'text',
      name: 'title',
      maxlength: 200,
      autocomplete: 'off',
      autocapitalize: 'sentences',
      enterkeyhint: 'enter',
      'aria-label': L.copy.inline.titleLabel
    });
    input.addEventListener('input', function (event) { onType(input.value, !!event.isComposing); });
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

  L.inline.row = { build: build, update: update };
})();
