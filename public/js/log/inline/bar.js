/*
 * The accessory bar: one thin paper row of icon keys pinned above the keyboard. It scrolls sideways when the keys do not fit.
 * Type, Tag, Date and Time open a popover. Delete, Up, Down, Indent and Outdent act on the entry. Details opens the sheet
 * and only shows for an entry that is already saved. One bar lives in <body> so a page redraw never touches it.
 * Needs ak-dom.js, copy.js, glyph.js, pop.js and viewport.js. actions: toggle(kind), act(name) and details().
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};
  L.inline = L.inline || {};

  var POPS = ['type', 'tag', 'date', 'time'];
  var ACTS = ['remove', 'up', 'down', 'indent', 'outdent'];
  var node = null;
  var keys = {};
  var pop = null;
  var popKind = '';

  /** One icon key. The words are only the accessible name, so the key shows an icon and nothing else. */
  function keyButton(kind, attrs, onclick) {
    var label = L.copy.inline.keys[kind];
    var base = { class: 'bar-key', type: 'button', 'data-key': kind, 'aria-label': label, title: label, onclick: onclick };
    Object.keys(attrs).forEach(function (name) { base[name] = attrs[name]; });
    keys[kind] = h('button', base, L.glyph.use('g-bar-' + kind));
    return keys[kind];
  }

  /** A key that opens a popover. aria-expanded says whether it is open. */
  function popKey(kind, actions) {
    return keyButton(kind, { 'aria-expanded': 'false', 'aria-haspopup': 'true' }, function () { actions.toggle(kind); });
  }

  /** A key that acts on the entry. A key that cannot act now says so with aria-disabled and does nothing when tapped. */
  function actKey(kind, actions) {
    return keyButton(kind, {}, function () {
      if (keys[kind].getAttribute('aria-disabled') !== 'true') actions.act(kind);
    });
  }

  /** Builds the bar once and puts it in the page, hidden. */
  function mount(actions) {
    if (node) return;
    var row = POPS.map(function (kind) { return popKey(kind, actions); })
      .concat(ACTS.map(function (kind) { return actKey(kind, actions); }))
      .concat([keyButton('details', { 'data-action': 'details' }, actions.details)]);
    node = h('div', { class: 'inline-bar', role: 'toolbar', 'aria-label': L.copy.inline.barLabel, 'data-edit-zone': '', hidden: true },
      h('div', { class: 'bar-keys' }, row));
    document.body.appendChild(node);
  }

  /** Greys the keys that cannot act now. caps: { up, down, indent, outdent } as true or false. */
  function setCaps(caps) {
    ['up', 'down', 'indent', 'outdent'].forEach(function (name) {
      keys[name].setAttribute('aria-disabled', caps[name] ? 'false' : 'true');
    });
  }

  /** Shows the bar for a line and pins it above the keyboard. Details only shows for an entry that is already saved. */
  function show(line, caps) {
    node.hidden = false;
    keys.details.hidden = line.isNew;
    setCaps(caps);
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

  /** Puts the popover above the key it belongs to, slid sideways so it stays inside the bar. The keys may be scrolled. */
  function anchor(kind) {
    var room = node.clientWidth - pop.offsetWidth - 12;
    var left = keys[kind].getBoundingClientRect().left - node.getBoundingClientRect().left;
    pop.style.left = Math.max(12, Math.min(left, room)) + 'px';
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
