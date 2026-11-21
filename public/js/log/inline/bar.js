/*
 * The accessory bar: a thin paper bar with four square keys (Type, Tag, Date, Time) and a Details link for saved entries.
 * One bar lives in <body> so a page redraw never touches it. Needs ak-dom.js, copy.js, pop.js and viewport.js.
 * actions: toggle(kind) and details().
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};
  L.inline = L.inline || {};

  var KINDS = ['type', 'tag', 'date', 'time'];
  var node = null;
  var keys = {};
  var detailsButton = null;
  var pop = null;
  var popKind = '';

  /** One square key. aria-expanded says whether its popover is open. */
  function keyButton(kind, actions) {
    var label = L.copy.inline.keys[kind];
    keys[kind] = h('button', {
      class: 'bar-key', type: 'button', 'data-key': kind, 'aria-expanded': 'false', 'aria-haspopup': 'true',
      onclick: function () { actions.toggle(kind); }
    }, label);
    return keys[kind];
  }

  /** Builds the bar once and puts it in the page, hidden. */
  function mount(actions) {
    if (node) return;
    detailsButton = h('button', { class: 'bar-details', type: 'button', 'data-action': 'details', onclick: actions.details }, L.copy.inline.details);
    node = h('div', { class: 'inline-bar', role: 'toolbar', 'aria-label': L.copy.inline.barLabel, 'data-edit-zone': '', hidden: true },
      h('div', { class: 'bar-keys' }, KINDS.map(function (kind) { return keyButton(kind, actions); })),
      detailsButton);
    document.body.appendChild(node);
  }

  /** Shows the bar for a line and pins it above the keyboard. Details only shows for an entry that is already saved. */
  function show(line) {
    node.hidden = false;
    detailsButton.hidden = line.isNew;
    L.inline.viewport.place(node);
  }

  /** Pins the bar again after the keyboard moved. */
  function place() {
    if (node && !node.hidden) L.inline.viewport.place(node);
  }

  /** The bar element, for scrolling checks. */
  function element() {
    return node;
  }

  /** Slides the popover left so it stays inside the bar, then leaves it under the key it belongs to. */
  function anchor(kind) {
    var room = node.clientWidth - pop.offsetWidth - 12;
    pop.style.left = Math.max(12, Math.min(keys[kind].offsetLeft, room)) + 'px';
  }

  /** Closes the popover, if one is open. */
  function closePop() {
    if (pop) pop.remove();
    pop = null;
    if (popKind) keys[popKind].setAttribute('aria-expanded', 'false');
    popKind = '';
  }

  /** Opens the popover of a key, replacing any other one. */
  function openPop(kind, line, cb) {
    closePop();
    pop = L.inline.pop.build(kind, line, cb);
    node.appendChild(pop);
    popKind = kind;
    keys[kind].setAttribute('aria-expanded', 'true');
    anchor(kind);
    return pop;
  }

  /** Hides the bar and its popover. */
  function hide() {
    if (!node) return;
    closePop();
    node.hidden = true;
  }

  L.inline.bar = {
    mount: mount, show: show, hide: hide, place: place, element: element,
    openPop: openPop, closePop: closePop,
    popKind: function () { return popKind; },
    popOpen: function () { return popKind !== ''; },
    popInput: function () { return pop ? pop.querySelector('input') : null; }
  };
})();
