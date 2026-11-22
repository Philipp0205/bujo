/*
 * Inked glyphs. The symbols live in a sprite at the top of index.html. Needs ak-dom.js and copy.js.
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};
  var NS = 'http://www.w3.org/2000/svg';

  var TYPES = ['task', 'note', 'event', 'done', 'migrated', 'scheduled'];
  var SYMBOLS = {
    task: 'g-task',
    note: 'g-note',
    event: 'g-event',
    done: 'g-done',
    migrated: 'g-moved',
    scheduled: 'g-sched'
  };

  /** An <svg> that draws one symbol of the sprite. attrs are set on the svg. */
  function use(symbol, attrs) {
    var svg = document.createElementNS(NS, 'svg');
    var ref = document.createElementNS(NS, 'use');
    ref.setAttribute('href', '#' + symbol);
    svg.setAttribute('aria-hidden', 'true');
    Object.keys(attrs || {}).forEach(function (key) { svg.setAttribute(key, attrs[key]); });
    svg.appendChild(ref);
    return svg;
  }

  /** The glyph of an entry type: dot, dash, circle, x, > or <. */
  function typeGlyph(type) {
    return use(SYMBOLS[type]);
  }

  /** The small ink dot for a sync state. The state is in data-sync, the colour in log.css. */
  function syncMark(sync) {
    var label = L.copy.sync[sync];
    return h('span', { class: 'sync-mark', 'data-sync': sync, title: label, role: 'img', 'aria-label': label }, use('g-mark'));
  }

  /** A small mark for a tag, a time, a day or "not synced". item is { kind, text, hue? }. The hue is the pen colour of the inked row. */
  function pill(item) {
    return h('span', { class: 'pill pill-' + item.kind, 'data-kind': item.kind, 'data-hue': item.hue || null, 'data-testid': item.testid || null }, item.text);
  }

  L.glyph = { TYPES: TYPES, use: use, typeGlyph: typeGlyph, syncMark: syncMark, pill: pill };
})();
