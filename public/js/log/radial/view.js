/*
 * The look of the planet menu: a paper veil over the log, the pressed entry as a small pencil pill in the middle (the planet) and the actions
 * as hand-drawn bubbles around it. It builds nodes and calls back, it never runs an action. Escape and a tap on the veil call onClose.
 * Needs ak-dom.js, glyph.js, radial/model.js and radial/copy.js.
 * open(spec): title, type (the entry's type, for the glyph), actions [key], at {x, y}, viewport {width, height}, onPick(key), onClose().
 * keyAt(x, y) is the action under a point (or null), hot(key) marks the bubble a dragging finger is over.
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};
  L.radial = L.radial || {};

  var NS = 'http://www.w3.org/2000/svg';
  var TITLE_MAX = 26;
  var BLOB_BOX = 42;
  var ICONS = {
    edit: ['M4 20 L5.5 14.5 L16 4 L20 8 L9.5 18.5 Z', 'M13.5 6.5 L17.5 10.5'],
    type: ['M5 6 H19', 'M12 6 V19', 'M8.5 19 H15.5'],
    select: ['M5 5.5 H19 V19 H5 Z', 'M8 12 L11 15.5 L16.5 8.5']
  };
  var GLYPHS = { done: 'done', reopen: 'task', migrate: 'migrated', schedule: 'scheduled', drop: 'dropped' };

  var veil = null;
  var onClose = null;

  /** An svg element with attributes. */
  function svg(tag, attrs) {
    var node = document.createElementNS(NS, tag);
    Object.keys(attrs).forEach(function (key) { node.setAttribute(key, attrs[key]); });
    return node;
  }

  /** The wobbly pencil circle behind a bubble. Each bubble has its own shape. */
  function blob(seed) {
    var box = svg('svg', { class: 'radial-blob', viewBox: '-' + BLOB_BOX + ' -' + BLOB_BOX + ' ' + BLOB_BOX * 2 + ' ' + BLOB_BOX * 2, 'aria-hidden': 'true' });
    box.appendChild(svg('path', { d: L.radial.model.blobPath(seed, 36) }));
    return box;
  }

  /** The small mark in a bubble: the glyph of the type it sets, or a hand-drawn line icon. */
  function icon(key) {
    var holder = h('span', { class: 'radial-icon' });
    if (GLYPHS[key]) {
      holder.appendChild(L.glyph.typeGlyph(GLYPHS[key]));
      return holder;
    }
    var mark = svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' });
    ICONS[key].forEach(function (d) { mark.appendChild(svg('path', { d: d })); });
    holder.appendChild(mark);
    return holder;
  }

  /** One action bubble: a pencil circle with its mark and its word. A tap calls onPick(key). */
  function bubble(key, index, offset, onPick) {
    var label = L.radial.copy.labels[key];
    return h('button', {
      class: 'radial-bubble', type: 'button', role: 'menuitem', 'data-action': key, 'data-testid': 'radial-' + key,
      style: 'left:' + offset.dx + 'px;top:' + offset.dy + 'px;--radial-delay:' + index * 24 + 'ms;--radial-tilt:' + (index % 2 ? 2 : -2) + 'deg',
      onclick: function (event) { event.stopPropagation(); onPick(key); }
    }, blob(index + 1), icon(key), h('span', { class: 'radial-label' }, label));
  }

  /** The pressed entry in the middle: its glyph and the start of its title, in a pencil pill. */
  function planet(spec) {
    var title = spec.title.length > TITLE_MAX ? spec.title.slice(0, TITLE_MAX - 1) + '\u2026' : spec.title;
    return h('div', { class: 'radial-planet', 'data-testid': 'radial-planet' }, L.glyph.typeGlyph(spec.type), h('span', { class: 'radial-planet-title' }, title));
  }

  /** The dashed pencil orbit the bubbles sit on. */
  function orbit(radius) {
    var box = svg('svg', { class: 'radial-orbit', viewBox: '-' + (radius + 4) + ' -' + (radius + 4) + ' ' + (radius + 4) * 2 + ' ' + (radius + 4) * 2, 'aria-hidden': 'true' });
    box.style.width = (radius + 4) * 2 + 'px';
    box.style.height = (radius + 4) * 2 + 'px';
    box.appendChild(svg('path', { d: L.radial.model.blobPath(11, radius) }));
    return box;
  }

  /** Escape closes the menu. */
  function onKey(event) {
    if (event.key === 'Escape' && onClose) onClose();
  }

  /** Opens the menu. The ring is placed by the model, so it stays on screen. */
  function open(spec) {
    close();
    var ring = L.radial.model.layout(spec.actions.length, spec.at, spec.viewport);
    onClose = spec.onClose;
    veil = h('div', {
      class: 'radial-veil', 'data-testid': 'radial-menu', 'aria-label': L.radial.copy.menuLabel,
      onclick: function (event) { if (event.target === veil) onClose(); }
    }, h('div', { class: 'radial-ring', role: 'menu', style: 'left:' + ring.cx + 'px;top:' + ring.cy + 'px' },
      orbit(L.radial.model.DEFAULTS.radius), planet(spec),
      spec.actions.map(function (key, index) { return bubble(key, index, ring.items[index], spec.onPick); })));
    document.body.appendChild(veil);
    document.addEventListener('keydown', onKey);
  }

  /** Closes the menu, if one is open. */
  function close() {
    if (veil) veil.remove();
    veil = null;
    onClose = null;
    document.removeEventListener('keydown', onKey);
  }

  /** True while the menu is open. */
  function isOpen() {
    return veil !== null;
  }

  /** The action of the bubble under a point, or null. */
  function keyAt(x, y) {
    var node = veil && document.elementFromPoint(x, y);
    var bubbleNode = node && node.closest('.radial-bubble');
    return bubbleNode ? bubbleNode.getAttribute('data-action') : null;
  }

  /** Marks the bubble under a dragging finger (and only that one). */
  function hot(key) {
    if (!veil) return;
    Array.prototype.forEach.call(veil.querySelectorAll('.radial-bubble'), function (node) {
      node.classList.toggle('is-hot', node.getAttribute('data-action') === key);
    });
  }

  L.radial.view = { open: open, close: close, isOpen: isOpen, keyAt: keyAt, hot: hot };
})();
