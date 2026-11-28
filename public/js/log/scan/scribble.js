/*
 * Pure model of the hand-drawn review markers: the path of a pen loop around a title (a pill) or a bullet (a ring).
 * No DOM, no strings. The same seed always gives the same loop, so tests and screenshots are stable.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.scan = L.scan || {};

  var PILL = { width: 200, height: 40 };
  var RING = { size: 24 };

  /** A 32 bit number from a text (FNV-1a), so a row id or a state name can seed its own loop. */
  function seedOf(text) {
    var hash = 2166136261;
    String(text).split('').forEach(function (char) {
      hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
    });
    return hash;
  }

  /** A small seeded random number source (mulberry32): each call gives a number from 0 up to 1. */
  function random(seed) {
    var state = seed >>> 0;
    return function () {
      state = (state + 0x6D2B79F5) >>> 0;
      var t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function round(value) {
    return Math.round(value * 10) / 10;
  }

  function dot(value) {
    return round(value.x) + ' ' + round(value.y);
  }

  /** A smooth path through the points: quadratic curves that bend at each point and end at the midpoint to the next. */
  function smooth(points) {
    var parts = ['M' + dot(points[0])];
    for (var at = 1; at < points.length - 1; at++) {
      var mid = { x: (points[at].x + points[at + 1].x) / 2, y: (points[at].y + points[at + 1].y) / 2 };
      parts.push('Q' + dot(points[at]) + ' ' + dot(mid));
    }
    parts.push('L' + dot(points[points.length - 1]));
    return parts.join(' ');
  }

  /** One pen pass around an oval: jittered radius, a start angle, a sweep (more than a full turn overshoots, less leaves a gap) and a slow drift off the start. */
  function pass(next, spec) {
    var points = [];
    var exponent = 2 / spec.power;
    for (var step = 0; step <= spec.steps; step++) {
      var angle = spec.start + spec.sweep * step / spec.steps;
      var c = Math.cos(angle);
      var s = Math.sin(angle);
      var scale = 1 + spec.drift * step / spec.steps + (next() - 0.5) * spec.wobble;
      points.push({
        x: spec.cx + spec.rx * Math.sign(c) * Math.pow(Math.abs(c), exponent) * scale,
        y: spec.cy + spec.ry * Math.sign(s) * Math.pow(Math.abs(s), exponent) * scale
      });
    }
    return smooth(points);
  }

  /** The two pen passes (a heavier one, then a lighter one that does not quite close) of a shape. base holds cx, cy, rx, ry, power, steps. */
  function strokes(seed, base) {
    var next = random(seedOf(seed));
    var first = Object.assign({ start: -2.6 + next() * 0.6, sweep: 6.28 + 0.3 + next() * 0.5, drift: 0.04 + next() * 0.03, wobble: 0.05 }, base);
    var second = Object.assign({}, base, { start: -1.2 + next() * 0.8, sweep: 5.6 + next() * 0.4, drift: -0.03 - next() * 0.03, wobble: 0.06, rx: base.rx + 0.8, ry: base.ry + 0.6 });
    return [{ d: pass(next, first), width: 1.7 }, { d: pass(next, second), width: 1 }];
  }

  /** The scribbled loop around a title, in a 200 by 40 box that is stretched to the pill. */
  function pill(seed) {
    return { viewBox: '0 0 ' + PILL.width + ' ' + PILL.height, strokes: strokes('pill:' + seed, { cx: 100, cy: 20, rx: 94, ry: 14.5, power: 3, steps: 30 }) };
  }

  /** The scribbled circle around a bullet, in a 24 by 24 box with its center at 12, 12. */
  function ring(seed) {
    var half = RING.size / 2;
    return { viewBox: '0 0 ' + RING.size + ' ' + RING.size, strokes: strokes('ring:' + seed, { cx: half, cy: half, rx: 9, ry: 9, power: 2, steps: 16 }) };
  }

  /** A point of a hand-drawn stroke, nudged by the pen's jitter. */
  function nudge(next, x, y) {
    return { x: x + (next() - 0.5) * 1.6, y: y + (next() - 0.5) * 1.6 };
  }

  /** A slightly bowed pen line from one point to another, as three points. */
  function line(next, from, to) {
    var mid = nudge(next, (from.x + to.x) / 2, (from.y + to.y) / 2);
    return smooth([nudge(next, from.x, from.y), mid, nudge(next, to.x, to.y)]);
  }

  /** The cross-out mark of "Not the same": two crossing pen lines in a 24 by 24 box. */
  function cross(seed) {
    var next = random(seedOf('cross:' + seed));
    return { viewBox: '0 0 24 24', strokes: [{ d: line(next, { x: 5.5, y: 5.5 }, { x: 18.5, y: 18.5 }), width: 1.8 }, { d: line(next, { x: 18.5, y: 5.5 }, { x: 5.5, y: 18.5 }), width: 1.8 }] };
  }

  /** The "Match again" mark: an open pen circle that ends in a small arrowhead, in a 24 by 24 box. */
  function again(seed) {
    var next = random(seedOf('again:' + seed));
    var start = -0.2;
    var end = 4.9;
    var points = [];
    for (var step = 0; step <= 10; step++) {
      var angle = start + (end - start) * step / 10;
      points.push(nudge(next, 12 + 7.5 * Math.cos(angle), 12 + 7.5 * Math.sin(angle)));
    }
    var tip = { x: 12 + 7.5 * Math.cos(end), y: 12 + 7.5 * Math.sin(end) };
    var along = { x: -Math.sin(end), y: Math.cos(end) };
    var across = { x: Math.cos(end), y: Math.sin(end) };
    var head = smooth([
      { x: tip.x - 4.5 * along.x + 3.5 * across.x, y: tip.y - 4.5 * along.y + 3.5 * across.y },
      tip,
      { x: tip.x - 4.5 * along.x - 3.5 * across.x, y: tip.y - 4.5 * along.y - 3.5 * across.y }
    ]);
    return { viewBox: '0 0 24 24', strokes: [{ d: smooth(points), width: 1.8 }, { d: head, width: 1.8 }] };
  }

  /** The pen arrow between two picker words: a bowed shaft ending in a two-stroke head, in a 32 by 16 box. */
  function arrow(seed) {
    var next = random(seedOf('arrow:' + seed));
    var shaft = smooth([nudge(next, 2, 8.5), nudge(next, 15, 7.5), nudge(next, 28, 8)]);
    var head = smooth([nudge(next, 22, 2.5), nudge(next, 28.5, 8), nudge(next, 22, 13.5)]);
    return { viewBox: '0 0 32 16', strokes: [{ d: shaft, width: 1.7 }, { d: head, width: 1.7 }] };
  }

  /** The short pen line a collection branches off with (no head), in a 24 by 16 box. */
  function branch(seed) {
    var next = random(seedOf('branch:' + seed));
    return { viewBox: '0 0 24 16', strokes: [{ d: smooth([nudge(next, 2, 12), nudge(next, 12, 8.5), nudge(next, 22, 4)]), width: 1.7 }] };
  }

  L.scan.scribble = { seedOf: seedOf, random: random, smooth: smooth, pill: pill, ring: ring, cross: cross, again: again, arrow: arrow, branch: branch };
})();
