/*
 * Pure model of the planet menu (the radial menu of a long press on a log row): which actions an entry offers, where the bubbles of the ring
 * sit, how the ring is kept on screen, and the wobbly outline of a hand-drawn circle. No DOM, no strings.
 * actionsFor(entry) gives the action keys in ring order, clockwise from the top.
 * layout(count, at, viewport, options) gives { cx, cy, items: [{ dx, dy }] }, the ring centre (clamped) and each bubble's offset from it.
 * blobPath(seed, r) gives the d of a closed, slightly uneven circle of radius r around 0,0.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.radial = L.radial || {};

  var DEFAULTS = { radius: 92, bubble: 68, side: 6, top: 56, bottom: 88 };
  var BLOB_POINTS = 10;
  var WOBBLE = 0.1;

  /** The actions of an entry, clockwise from the top. An open task can be ticked and moved, a done one reopened, any other can be dropped. A dropped entry stays as it is. */
  function actionsFor(entry) {
    if (entry.type === 'task') return ['done', 'migrate', 'schedule', 'edit', 'type', 'select'];
    if (entry.type === 'done') return ['done', 'edit', 'type', 'drop', 'select'];
    if (entry.type === 'dropped') return ['edit', 'type', 'select'];
    return ['edit', 'type', 'drop', 'select'];
  }

  /** A value held between two limits. When the limits cross (a room too small for the ring) the middle is taken. */
  function clamp(value, low, high) {
    if (low > high) return (low + high) / 2;
    return Math.min(high, Math.max(low, value));
  }

  /** Rounds to two decimals. */
  function round(value) {
    return Math.round(value * 100) / 100;
  }

  /** The ring: its centre is the press point kept far enough from the edges, the top bar and the dock that every bubble stays on screen. */
  function layout(count, at, viewport, options) {
    var o = Object.assign({}, DEFAULTS, options);
    var extent = o.radius + o.bubble / 2;
    var items = [];
    for (var index = 0; index < count; index += 1) {
      var angle = -Math.PI / 2 + (index * 2 * Math.PI) / count;
      items.push({ dx: round(Math.cos(angle) * o.radius), dy: round(Math.sin(angle) * o.radius) });
    }
    return {
      cx: round(clamp(at.x, extent + o.side, viewport.width - extent - o.side)),
      cy: round(clamp(at.y, o.top + extent, viewport.height - o.bottom - extent)),
      items: items
    };
  }

  /** A repeatable pseudo-random number from 0 to 1 for a seed, so a bubble keeps its shape. */
  function noise(seed, step) {
    var value = Math.sin(seed * 12.9898 + step * 78.233) * 43758.5453;
    return value - Math.floor(value);
  }

  /** The outline of a hand-drawn circle: points a little off the true radius, joined by smooth curves. */
  function blobPath(seed, r) {
    var points = [];
    for (var index = 0; index < BLOB_POINTS; index += 1) {
      var angle = (index / BLOB_POINTS) * 2 * Math.PI;
      var reach = r * (1 + (noise(seed, index) - 0.5) * 2 * WOBBLE);
      points.push({ x: Math.cos(angle) * reach, y: Math.sin(angle) * reach });
    }
    var mid = function (a, b) { return round((a.x + b.x) / 2) + ' ' + round((a.y + b.y) / 2); };
    var last = points[BLOB_POINTS - 1];
    var d = 'M' + mid(last, points[0]);
    points.forEach(function (point, index) {
      d += ' Q' + round(point.x) + ' ' + round(point.y) + ' ' + mid(point, points[(index + 1) % BLOB_POINTS]);
    });
    return d + ' Z';
  }

  L.radial.model = { DEFAULTS: DEFAULTS, actionsFor: actionsFor, layout: layout, blobPath: blobPath };
})();
