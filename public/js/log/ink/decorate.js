/*
 * The ink decorator: draws the pen outlines of path.js as <svg class="ink-stroke"> inside the nodes that wear them (the Today
 * underline, the edit sheet, its handle, rule and chips, the Notes cards and the cards of plain pages). The rows of the log
 * wear none: they are plain ink on the paper. Each node keeps a stable seed, so a
 * redraw (after a re-render or a resize) gives the same wobble. A ResizeObserver per group redraws a node when its size
 * changes. A group is watched again from scratch on each call, so nodes that left the page are never kept alive.
 * Needs path.js. No animation, so prefers-reduced-motion needs nothing.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.ink = L.ink || {};

  var NS = 'http://www.w3.org/2000/svg';
  var SHAPES = {
    card: { kind: 'rect', radius: 16, scale: 1 },
    thumb: { kind: 'rect', radius: 10, scale: 0.7 },
    pill: { kind: 'rect', radius: 0, scale: 0.5 },
    sheet: { kind: 'rect', radius: 22, scale: 1.25, openBottom: true },
    underline: { kind: 'line', extra: 3 },
    handle: { kind: 'line', extra: 0 },
    rule: { kind: 'line', extra: 0 }
  };

  var specs = new WeakMap();
  var observers = {};

  /** Remembers what a node wears: its shape and its seed. The size it was last drawn at starts empty. */
  function wear(el, shape, seed) {
    specs.set(el, { shape: SHAPES[shape], name: shape, seed: seed, w: 0, h: 0 });
  }

  /** The strokes for a node of size w by h, as the path generator makes them. A pill is round: its radius is half its height. */
  function strokesFor(spec, w, h) {
    var shape = spec.shape;
    if (shape.kind === 'line') return L.ink.path.line(w + shape.extra, spec.seed, spec.name);
    var radius = shape.radius || h / 2;
    return L.ink.path.rect(w, h, spec.seed, { radius: radius, scale: shape.scale, openBottom: !!shape.openBottom });
  }

  /** One <svg> with the strokes as paths in the current colour. Lines get a class for their place in the node. */
  function svgOf(spec, w, h, strokes) {
    var line = spec.shape.kind === 'line';
    var box = line ? w + spec.shape.extra : w;
    var tall = line ? L.ink.path.lineHeight(spec.name) : h;
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'ink-stroke' + (line ? ' ink-' + spec.name : ''));
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('viewBox', '0 0 ' + box + ' ' + tall);
    strokes.forEach(function (stroke) {
      var path = document.createElementNS(NS, 'path');
      path.setAttribute('d', stroke.d);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'currentColor');
      path.setAttribute('stroke-width', String(stroke.width));
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      path.setAttribute('opacity', String(stroke.opacity));
      svg.appendChild(path);
    });
    return svg;
  }

  /** Removes the ink a node already wears, so a redraw never stacks a second svg. */
  function clear(el) {
    Array.prototype.forEach.call(el.children, function (child) {
      if (child.classList.contains('ink-stroke')) child.remove();
    });
  }

  /** How big a node is now. */
  function measure(el) {
    var box = el.getBoundingClientRect();
    return { w: Math.round(box.width * 100) / 100, h: Math.round(box.height * 100) / 100 };
  }

  /** Draws a node at the measured size with its own seed. A node too small to outline (hidden, empty) wears nothing. */
  function draw(el, size) {
    var spec = specs.get(el);
    if (!spec || (spec.w === size.w && spec.h === size.h && el.querySelector(':scope > svg.ink-stroke'))) return;
    spec.w = size.w;
    spec.h = size.h;
    clear(el);
    if (size.w < 4 || (spec.shape.kind === 'rect' && size.h < 4)) return;
    el.insertBefore(svgOf(spec, size.w, size.h, strokesFor(spec, size.w, size.h)), el.firstChild);
  }

  /** Measures first and draws after, so the drawing never forces a layout in between. */
  function drawAll(els) {
    var sizes = els.map(measure);
    els.forEach(function (el, at) { draw(el, sizes[at]); });
  }

  /** Redraws a node whose size changed, with the seed it already has. */
  function onResize(entries) {
    var els = entries.map(function (entry) { return entry.target; });
    drawAll(els);
  }

  /** Watches exactly these nodes for the group, dropping whatever the group watched before. */
  function watch(group, els) {
    if (typeof ResizeObserver === 'undefined') return;
    if (!observers[group]) observers[group] = new ResizeObserver(onResize);
    observers[group].disconnect();
    els.forEach(function (el) { observers[group].observe(el, { box: 'border-box' }); });
  }

  /** Gives every node of a selector its shape, seeded by seedOf(node). Returns the nodes. */
  function dress(root, selector, shape, seedOf) {
    var els = Array.prototype.slice.call(root.querySelectorAll(selector));
    els.forEach(function (el) { wear(el, shape, seedOf(el)); });
    return els;
  }

  /** Inks the list: the Today mark and the view on screen in the switcher. Rows, nested rows and their tags are plain ink on the paper, with no outline. Call after the list is painted. */
  function list(root) {
    var els = dress(root, '.today', 'underline', function () { return 'today'; })
      .concat(dress(root, '.view-tab[aria-pressed="true"]', 'underline', function (el) { return 'view|' + el.getAttribute('data-testid'); }));
    watch('list', els);
    drawAll(els);
  }

  /** Inks the chips of the edit sheet under root. Call when its chips are patched. */
  function chips(root) {
    var els = dress(root, '.sheet-chips .pill', 'pill', function (el) { return 'chip|' + el.getAttribute('data-kind') + '|' + el.textContent; });
    watch('chips', els);
    drawAll(els);
  }

  /** Inks the edit sheet: its wobbly top, the handle and the rule above the bar. Call when the sheet is shown (the chips have chips()). */
  function sheet(node) {
    var parts = [node, node.querySelector('.edit-handle'), node.querySelector('.inline-bar')];
    if (!specs.has(node)) {
      wear(node, 'sheet', 'sheet');
      wear(parts[1], 'handle', 'handle');
      wear(parts[2], 'rule', 'rule');
    }
    watch('sheet', parts);
    drawAll(parts);
  }

  /** The id of a note card: its own data-id, or the card around it. */
  function noteId(el) {
    var card = el.matches('.note-card') ? el : el.closest('.note-card');
    return card ? card.getAttribute('data-id') || 'new' : 'new';
  }

  /** Inks the Notes grid: each card, and the frame of each thumbnail inside it. Call after the grid is painted. */
  function notes(root) {
    var els = []
      .concat(dress(root, '.note-card', 'card', function (el) { return 'note|' + noteId(el); }))
      .concat(dress(root, '.note-thumb', 'thumb', function (el) { return 'thumb|' + noteId(el); }));
    watch('notes', els);
    drawAll(els);
  }

  /** A seed for a card on a plain page: its own name (data-card, data-panel, data-item), else its place on the page. */
  function screenSeed(el, at) {
    var name = el.getAttribute('data-card') || el.getAttribute('data-panel') || el.getAttribute('data-item');
    return 'screen|' + (name || at);
  }

  /** Inks the cards of a plain page (Settings, sign-in, Backlog, Scan): every .bj-card under root. Call after each re-render. */
  function screen(root) {
    var cards = Array.prototype.slice.call(root.querySelectorAll('.bj-card'));
    cards.forEach(function (el, at) { wear(el, 'card', screenSeed(el, at)); });
    watch('screen', cards);
    drawAll(cards);
  }

  L.ink.decorate = { list: list, notes: notes, chips: chips, sheet: sheet, screen: screen };
})();
