/*
 * Pure model of the pen-stroke bullets: the strokes of a task dot, a done x, a > or <, a note dash, an event circle and a dropped dot with a short diagonal slash through its middle.
 * strokes(type, seed) gives { viewBox, strokes: [{ d, width }] } in a 16 by 16 box. The same type and seed always give the same
 * strokes (the seed is the entry id), a different seed wobbles a little differently. No DOM, no strings.
 * Needs scan/scribble.js (seedOf, random, smooth).
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.ink = L.ink || {};

  var BOX = '0 0 16 16';
  var JITTER = 0.7;

  /** The pen's width for a stroke: the base width, varied a little so no two strokes are the same weight. */
  function width(next, base) {
    return Math.round((base + (next() - 0.5) * 0.3) * 100) / 100;
  }

  /** A point nudged by the pen's jitter. */
  function nudge(next, x, y) {
    return { x: x + (next() - 0.5) * JITTER, y: y + (next() - 0.5) * JITTER };
  }

  /** A slightly bowed pen line from one point to another, as three points. */
  function line(next, from, to) {
    var mid = nudge(next, (from.x + to.x) / 2, (from.y + to.y) / 2);
    return L.scan.scribble.smooth([nudge(next, from.x, from.y), mid, nudge(next, to.x, to.y)]);
  }

  /** One stroke of the strokes list. */
  function stroke(next, from, to, base) {
    return { d: line(next, { x: from[0], y: from[1] }, { x: to[0], y: to[1] }), width: width(next, base) };
  }

  /** The task dot: a very short pen press, a little oval that is never quite round. */
  function dot(next) {
    var x = 8 + (next() - 0.5) * 0.5;
    var y = 8 + (next() - 0.5) * 0.5;
    var path = 'M' + (x - 0.4).toFixed(1) + ' ' + (y - 0.2).toFixed(1) + ' L' + (x + 0.5).toFixed(1) + ' ' + (y + 0.3).toFixed(1);
    return { d: path, width: width(next, 3.9) };
  }

  /** The event circle: one pen pass around, a little past where it started, and a hair off round. */
  function circle(next) {
    var start = -2.4 + next() * 1.2;
    var sweep = 6.5 + next() * 0.5;
    var points = [];
    for (var step = 0; step <= 10; step++) {
      var angle = start + sweep * step / 10;
      var radius = 3.4 + (next() - 0.5) * 0.5 + 0.25 * step / 10;
      points.push({ x: 8 + radius * Math.cos(angle), y: 8 + radius * Math.sin(angle) });
    }
    return { d: L.scan.scribble.smooth(points), width: width(next, 1.4) };
  }

  var DRAW = {
    task: function (next) { return [dot(next)]; },
    note: function (next) { return [stroke(next, [3.4, 8], [12.6, 8], 1.4)]; },
    event: function (next) { return [circle(next)]; },
    done: function (next) { return [stroke(next, [4.8, 4.8], [11.2, 11.2], 1.5), stroke(next, [11.2, 4.8], [4.8, 11.2], 1.4)]; },
    migrated: function (next) { return [stroke(next, [5.8, 4.4], [10.6, 8], 1.4), stroke(next, [10.6, 8], [5.8, 11.6], 1.4)]; },
    scheduled: function (next) { return [stroke(next, [10.2, 4.4], [5.4, 8], 1.4), stroke(next, [5.4, 8], [10.2, 11.6], 1.4)]; },
    dropped: function (next) { return [dot(next), stroke(next, [3.8, 12.2], [12.2, 3.8], 1.5)]; }
  };

  /** The pen strokes of a bullet type, drawn from a seed. Null for a type with no bullet. */
  function strokes(type, seed) {
    if (!DRAW[type]) return null;
    var next = L.scan.scribble.random(L.scan.scribble.seedOf(type + ':' + seed));
    return { viewBox: BOX, strokes: DRAW[type](next) };
  }

  L.ink.bulletModel = { TYPES: Object.keys(DRAW), strokes: strokes };
})();
