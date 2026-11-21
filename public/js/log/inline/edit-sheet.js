/*
 * The edit sheet: a paper bottom sheet that holds the line being typed (symbol, title, chips, error) and the accessory bar.
 * It sits at the bottom of the visual viewport, so on a phone it rides on top of the keyboard. The list behind it is dimmed
 * by log.css while html.is-editing is set. One sheet lives in <body>, so a page redraw never touches the input and the
 * keyboard stays up. Needs ak-dom.js, copy.js, viewport.js and the ink decorator. It builds and shows nodes, it never saves anything.
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};
  L.inline = L.inline || {};

  var node = null;

  /** Builds the sheet once, hidden: a handle, then the line and the bar. */
  function mount(line, bar) {
    if (node) return;
    node = h('div', {
      class: 'edit-sheet', role: 'group', 'aria-label': L.copy.inline.sheetLabel, 'data-testid': 'edit-sheet', 'data-edit-zone': '', hidden: true
    }, h('div', { class: 'edit-handle', 'aria-hidden': 'true' }), line, bar);
    document.body.appendChild(node);
    L.ink.decorate.sheet(node);
  }

  /** Pins the sheet just above the keyboard (or to the screen bottom when there is none). */
  function place() {
    if (node && !node.hidden) L.inline.viewport.place(node);
  }

  /** Shows the sheet, pins it above the keyboard and draws its pen strokes at the size it has now. */
  function show() {
    node.hidden = false;
    place();
    L.ink.decorate.sheet(node);
  }

  /** Hides the sheet. */
  function hide() {
    if (node) node.hidden = true;
  }

  /** The sheet element, or null before it is mounted. */
  function element() {
    return node;
  }

  L.inline.editSheet = { mount: mount, show: show, hide: hide, place: place, element: element };
})();
