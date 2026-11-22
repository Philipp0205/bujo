/*
 * The accessory bar: one thin row of icon keys at the bottom of the edit sheet, above the keyboard. It scrolls sideways when
 * the keys do not fit. Type, Tag, Date and Time open a popover. Copy, Delete, Up, Down, Indent and Outdent act on the entry.
 * Details opens the details sheet and only shows for an entry that is already saved. The bar is built once and the edit
 * sheet holds it, so a page redraw never touches it.
 * Needs ak-dom.js, copy.js, glyph.js and pop.js. actions: toggle(kind), act(name) and details().
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};
  L.inline = L.inline || {};

  var POPS = ['type', 'tag', 'date', 'time'];
  var ACTS = ['copy', 'remove', 'up', 'down', 'indent', 'outdent'];
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

  /** Builds the bar once. The edit sheet puts it in the page. */
  function mount(actions) {
    if (node) return node;
    var row = POPS.map(function (kind) { return popKey(kind, actions); })
      .concat(ACTS.map(function (kind) { return actKey(kind, actions); }))
      .concat([keyButton('details', { 'data-action': 'details' }, actions.details)]);
    node = h('div', { class: 'inline-bar', role: 'toolbar', 'aria-label': L.copy.inline.barLabel },
      h('div', { class: 'bar-keys' }, row));
    return node;
  }

  /** Greys the keys that cannot act now. caps: { up, down, indent, outdent } as true or false. */
  function setCaps(caps) {
    ['up', 'down', 'indent', 'outdent'].forEach(function (name) {
      keys[name].setAttribute('aria-disabled', caps[name] ? 'false' : 'true');
    });
  }

  /** Updates the bar for a line: Details only shows for an entry the server has (not a new line, not one still waiting to be sent), Copy only once there is a title, and the keys that cannot act are greyed. */
  function show(line, caps) {
    keys.details.hidden = line.isNew || (line.original && line.original.queued === 'create');
    keys.copy.hidden = !caps.copy;
    setCaps(caps);
  }

  /** The bar element, for the sheet. */
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

  L.inline.bar = {
    mount: mount, show: show, element: element,
    openPop: openPop, closePop: closePop,
    popKind: function () { return popKind; },
    popOpen: function () { return popKind !== ''; },
    popInput: function () { return pop ? pop.querySelector('input') : null; }
  };
})();
