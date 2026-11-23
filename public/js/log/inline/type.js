/*
 * The type marker of the edit sheet and its chooser. The marker is the glyph at the start of the line, drawn as a small ink chip
 * with a caret, and it is the one control for the entry type. A tap opens a compact chooser of every type (glyph and label)
 * above the sheet, so the line and the accessory bar stay uncovered. It builds nodes and calls back, it never changes a line.
 * Needs ak-dom.js, copy.js, glyph.js and edit-sheet.js (the chooser lives in the sheet, so a press on it keeps the title focused).
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};
  L.inline = L.inline || {};

  // The classic bullet journal order: task, done, moved, scheduled, event, note. A type added to glyph.js later is appended.
  var ORDER = ['task', 'done', 'migrated', 'scheduled', 'event', 'note'];
  var marker = null;
  var chooser = null;

  /** Every type the app has, in the order of the chooser. */
  function order() {
    return ORDER.concat(L.glyph.TYPES.filter(function (type) { return ORDER.indexOf(type) < 0; }));
  }

  /** The marker chip: the glyph of the type and a small caret that says there is more behind it. */
  function chip(type) {
    return h('span', { class: 'type-marker-chip' }, L.glyph.typeGlyph(type), h('span', { class: 'type-marker-caret', 'aria-hidden': 'true' }));
  }

  /** Builds the marker button once. Its box is a 44px target that stops at the edge of the title. onTap runs on a press. */
  function build(type, onTap) {
    marker = h('button', {
      class: 'type-marker', type: 'button', 'data-testid': 'type-marker', 'data-type': type,
      'aria-haspopup': 'true', 'aria-expanded': 'false', 'aria-label': L.copy.inline.typeMarker(L.copy.typeLabels[type]),
      onclick: onTap
    }, chip(type));
    return marker;
  }

  /** Shows the type of the line on the marker (glyph and accessible name) without replacing the button, so focus stays put. */
  function patch(type) {
    if (!marker || marker.getAttribute('data-type') === type) return;
    marker.setAttribute('data-type', type);
    marker.setAttribute('aria-label', L.copy.inline.typeMarker(L.copy.typeLabels[type]));
    var old = marker.querySelector('.type-marker-chip');
    marker.replaceChild(chip(type), old);
  }

  /** One row of the chooser: the glyph and the label. The type of the line is pressed. */
  function option(type, current, onPick) {
    return h('button', {
      class: 'type-option', type: 'button', 'data-type': type, 'aria-pressed': type === current ? 'true' : 'false',
      onclick: function () { onPick(type); }
    }, L.glyph.typeGlyph(type), h('span', { class: 'type-option-label' }, L.copy.typeLabels[type]));
  }

  /** True while the chooser is open. */
  function isOpen() {
    return chooser !== null;
  }

  /** Closes the chooser, if one is open. */
  function close() {
    if (chooser) chooser.remove();
    chooser = null;
    if (marker) marker.setAttribute('aria-expanded', 'false');
  }

  /** Opens the chooser above the sheet. current is the type of the line, onPick(type) runs on a tap on a type. */
  function open(current, onPick) {
    close();
    chooser = h('div', { class: 'type-chooser', role: 'group', 'aria-label': L.copy.inline.typeChooser, 'data-testid': 'type-chooser' },
      order().map(function (type) { return option(type, current, onPick); }));
    L.inline.editSheet.element().appendChild(chooser);
    marker.setAttribute('aria-expanded', 'true');
  }

  L.inline.type = { build: build, patch: patch, open: open, close: close, isOpen: isOpen, order: order, option: option };
})();
