/*
 * The ink path generator: jittered pen outlines as SVG path strings, with no library and no DOM. The same seed and size always
 * give the same strokes, so a redraw never changes the wobble. Only the subtle pen is shipped. Hangs on window.BujoLog.ink.path.
 * rect(w, h, seed, options) and line(w, seed, kind) return strokes: [{ d, width, opacity }], drawn in the ink colour.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.ink = L.ink || {};

  var PEN = {
    roughness: 0.5,
    bow: 0.65,
    step: 9,
    stroke: 1.12,
    stroke2: 0.82,
    pass2: 0.32,
    pass2Shift: 0.4,
    radiusJitter: 1.1,
    gap: 0.7,
    overshoot: 0.5
  };

  /** The height of the box a line is drawn in, by kind. */
  var LINE_HEIGHT = { underline: 7, handle: 8, rule: 8 };

  /** A small seeded random number generator: the same seed gives the same run of numbers. */
  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** A 32 bit hash of a string, so a text seed (an entry id) can start the generator. */
  function hash(text) {
    var h = 2166136261;
    for (var i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function rngFor(seed) { return mulberry32(hash(String(seed))); }
  function rand(rng, a, b) { return a + rng() * (b - a); }
  function jitter(rng, amp) { return (rng() * 2 - 1) * amp; }

  /** Turns points into a smooth path (quadratic curves through midpoints). A closed path stops a little short of its start, like a pen lifted. */
  function pathFromPoints(pts, close, gap) {
    if (!pts || pts.length < 2) return '';
    var p = pts.slice();
    if (close) {
      if (gap > 0 && p.length > 4) {
        var ex = p[p.length - 1][0], ey = p[p.length - 1][1];
        var dx = p[0][0] - ex, dy = p[0][1] - ey;
        var t = Math.max(0, 1 - gap / (Math.hypot(dx, dy) || 1));
        p[p.length - 1] = [ex + dx * t, ey + dy * t];
      } else {
        p.push(p[0]);
      }
    }
    var d = 'M' + p[0][0].toFixed(2) + ' ' + p[0][1].toFixed(2);
    for (var i = 1; i < p.length - 1; i++) {
      var mx = (p[i][0] + p[i + 1][0]) / 2;
      var my = (p[i][1] + p[i + 1][1]) / 2;
      d += 'Q' + p[i][0].toFixed(2) + ' ' + p[i][1].toFixed(2) + ' ' + mx.toFixed(2) + ' ' + my.toFixed(2);
    }
    var last = p[p.length - 1];
    return d + 'L' + last[0].toFixed(2) + ' ' + last[1].toFixed(2);
  }

  /** Points along a straight line that wander a little to the side and bow in the middle. */
  function wobblyLine(x1, y1, x2, y2, rng, roughness, bow, step) {
    var dx = x2 - x1, dy = y2 - y1;
    var len = Math.hypot(dx, dy) || 1;
    var nx = -dy / len, ny = dx / len;
    var n = Math.max(2, Math.round(len / step));
    var bowAmp = jitter(rng, bow);
    var pts = [];
    for (var i = 0; i <= n; i++) {
      var t = i / n;
      var fade = Math.sin(t * Math.PI);
      var side = jitter(rng, roughness) * (0.3 + 0.7 * fade) + fade * bowAmp;
      var slide = jitter(rng, roughness * 0.22);
      pts.push([x1 + dx * t + (dx / len) * slide + nx * side, y1 + dy * t + (dy / len) * slide + ny * side]);
    }
    return pts;
  }

  /** Points along a corner arc whose radius drifts a little. */
  function wobblyArc(cx, cy, r, a0, a1, rng, roughness, step) {
    var da = a1 - a0;
    var n = Math.max(3, Math.round(Math.abs(da) * r / Math.max(4, step * 0.85)));
    var pts = [];
    for (var i = 0; i <= n; i++) {
      var t = i / n;
      var rr = r + jitter(rng, roughness) * (0.35 + 0.65 * Math.sin(t * Math.PI));
      pts.push([cx + rr * Math.cos(a0 + da * t), cy + rr * Math.sin(a0 + da * t)]);
    }
    return pts;
  }

  /** Joins point runs into one, dropping a point that repeats the end of the run before it. */
  function join(parts) {
    var out = parts[0].slice();
    for (var i = 1; i < parts.length; i++) {
      var seg = parts[i];
      var last = out[out.length - 1];
      var near = Math.hypot(last[0] - seg[0][0], last[1] - seg[0][1]) < 0.2;
      out.push.apply(out, near ? seg.slice(1) : seg);
    }
    return out;
  }

  function capRadius(r, w, h) {
    return Math.max(2, Math.min(r, Math.min(w, h) / 2 - 0.5));
  }

  /** The outline of a rounded rectangle as points. An open bottom runs the sides past the box, for a sheet that leaves the screen. */
  function roundedRectPoints(w, h, radii, rng, opt, pad, openBottom) {
    var x = pad, y = pad;
    w = Math.max(8, w - pad * 2);
    h = Math.max(8, h - pad * 2);
    var tl = capRadius(radii.tl, w, h), tr = capRadius(radii.tr, w, h);
    var br = capRadius(radii.br, w, h), bl = capRadius(radii.bl, w, h);
    var r = opt.roughness, bow = opt.bow, step = opt.step, half = Math.PI / 2;
    var top = wobblyLine(x + tl, y, x + w - tr, y, rng, r, bow, step);
    if (openBottom) {
      return join([
        top,
        wobblyArc(x + w - tr, y + tr, tr, -half, 0, rng, r, step),
        wobblyLine(x + w, y + tr, x + w, h + pad + 8, rng, r, bow * 0.4, step),
        wobblyLine(x, h + pad + 8, x, y + tl, rng, r, bow * 0.4, step),
        wobblyArc(x + tl, y + tl, tl, Math.PI, Math.PI + half, rng, r, step)
      ]);
    }
    return join([
      top,
      wobblyArc(x + w - tr, y + tr, tr, -half, 0, rng, r, step),
      wobblyLine(x + w, y + tr, x + w, y + h - br, rng, r, bow, step),
      wobblyArc(x + w - br, y + h - br, br, 0, half, rng, r, step),
      wobblyLine(x + w - br, y + h, x + bl, y + h, rng, r, bow, step),
      wobblyArc(x + bl, y + h - bl, bl, half, Math.PI, rng, r, step),
      wobblyLine(x, y + h - bl, x, y + tl, rng, r, bow, step),
      wobblyArc(x + tl, y + tl, tl, Math.PI, Math.PI + half, rng, r, step)
    ]);
  }

  /** The four corner radii, each a little off the base radius. */
  function radiiFor(w, h, base, rng, opt) {
    var cap = function (r) { return Math.max(3, Math.min(r, Math.min(w, h) / 2)); };
    return {
      tl: cap(base + jitter(rng, opt.radiusJitter)),
      tr: cap(base + jitter(rng, opt.radiusJitter)),
      br: cap(base + jitter(rng, opt.radiusJitter)),
      bl: cap(base + jitter(rng, opt.radiusJitter))
    };
  }

  /** Starts the pen a hair before the first point, like a stroke that began just outside the corner. */
  function overshoot(pts, rng, opt) {
    if (opt.overshoot <= 0.4 || pts.length <= 6) return pts;
    var a = pts[0], b = pts[1];
    var dx = a[0] - b[0], dy = a[1] - b[1];
    var len = Math.hypot(dx, dy) || 1;
    pts.unshift([a[0] + (dx / len) * opt.overshoot * rand(rng, 0.4, 1), a[1] + (dy / len) * opt.overshoot * rand(rng, 0.4, 1)]);
    return pts;
  }

  /** The pen for a smaller shape: less wobble, shorter steps. scale 1 is the base pen. */
  function scaledPen(scale) {
    if (!scale || scale === 1) return PEN;
    var opt = {};
    Object.keys(PEN).forEach(function (key) { opt[key] = PEN[key]; });
    ['roughness', 'bow', 'radiusJitter', 'gap', 'overshoot'].forEach(function (key) { opt[key] = PEN[key] * scale; });
    opt.step = Math.max(5, PEN.step * (scale < 1 ? 0.7 : 1));
    return opt;
  }

  /**
   * The strokes of a rounded rectangle of w by h: a main stroke and a faint second pass. options: radius (corner radius in px),
   * scale (1 is the base pen, less for small shapes) and openBottom (no bottom edge, for a sheet).
   */
  function rect(w, h, seed, options) {
    var opt = scaledPen(options.scale);
    var open = !!options.openBottom;
    var rng = rngFor(seed);
    var inset = Math.max(0.7, opt.stroke / 2 + 0.4);
    var first = overshoot(roundedRectPoints(w, h, radiiFor(w, h, options.radius, rng, opt), rng, opt, inset, open), rng, opt);
    var rng2 = rngFor(seed + '|pass2');
    var second = roundedRectPoints(w + opt.pass2Shift, h + opt.pass2Shift, radiiFor(w, h, options.radius, rng2, opt), rng2, opt,
      inset - opt.pass2Shift * 0.3, open);
    return [
      { d: pathFromPoints(first, !open, opt.gap), width: opt.stroke, opacity: 1 },
      { d: pathFromPoints(second, !open, opt.gap * 1.2), width: opt.stroke2, opacity: opt.pass2 }
    ];
  }

  /** The strokes of an underline or a sheet handle across w. The underline has a faint second pass. */
  function inkLine(w, seed, kind) {
    var h = LINE_HEIGHT[kind];
    var rng = rngFor(seed + '|' + kind);
    var y = h * 0.55;
    var handle = kind === 'handle';
    var pad = handle ? 1 : 0.5;
    var roughness = PEN.roughness * (handle ? 0.8 : 0.7);
    var bow = kind === 'underline' ? PEN.bow * 1.1 + 0.4 : PEN.bow * 0.8;
    var pts = wobblyLine(pad, y + jitter(rng, 0.4), w - pad, y + jitter(rng, 0.6), rng, roughness, bow, 6);
    var width = handle ? 2.4 : 1.15;
    var strokes = [{ d: pathFromPoints(pts, false, 0), width: width, opacity: handle ? 0.82 : 1 }];
    if (kind === 'underline') {
      var rng2 = rngFor(seed + '|u2');
      var pts2 = wobblyLine(pad + 0.4, y + jitter(rng2, 0.5), w - pad, y + jitter(rng2, 0.5), rng2, roughness, bow, 6);
      strokes.push({ d: pathFromPoints(pts2, false, 0), width: width * 0.75, opacity: PEN.pass2 + 0.1 });
    }
    return strokes;
  }

  /** The thin rule above the accessory bar: one light stroke across w. */
  function inkRule(w, seed) {
    var rng = rngFor(seed + '|rule');
    var y = 1.6;
    var pts = wobblyLine(0, y, w, y + jitter(rng, 0.4), rng, PEN.roughness * 0.55, PEN.bow * 0.5, 10);
    return [{ d: pathFromPoints(pts, false, 0), width: 1.05, opacity: 0.7 }];
  }

  /** The strokes of a line of kind 'underline', 'handle' or 'rule' across w. */
  function line(w, seed, kind) {
    return kind === 'rule' ? inkRule(w, seed) : inkLine(w, seed, kind);
  }

  /** The wobbly square of a tick box in a 24 by 24 box: a pen outline with a faint second pass, a hair smaller than the box. */
  function box(seed) {
    return rect(24, 24, seed + '|box', { radius: 5, scale: 0.9 });
  }

  /** The pen tick of a tick box in a 24 by 24 box: a short down stroke and a long up stroke that leaves the box a little, plus a faint second pass. */
  function tick(seed) {
    var rng = rngFor(seed + '|tick');
    var down = wobblyLine(6.4 + jitter(rng, 0.5), 12.6 + jitter(rng, 0.5), 10.2 + jitter(rng, 0.4), 17 + jitter(rng, 0.4), rng, 0.3, 0.3, 4);
    var up = wobblyLine(10.2, 17, 20.2 + jitter(rng, 0.6), 4.8 + jitter(rng, 0.6), rng, 0.35, 0.5, 5);
    var again = wobblyLine(7 + jitter(rng, 0.4), 13 + jitter(rng, 0.4), 10.4, 16.6, rng, 0.3, 0.3, 4)
      .concat(wobblyLine(10.4, 16.6, 19.6 + jitter(rng, 0.5), 5.6 + jitter(rng, 0.5), rng, 0.35, 0.4, 5).slice(1));
    return [
      { d: pathFromPoints(join([down, up]), false, 0), width: 1.9, opacity: 1 },
      { d: pathFromPoints(again, false, 0), width: 1, opacity: 0.35 }
    ];
  }

  L.ink.path = { rect: rect, line: line, box: box, tick: tick, lineHeight: function (kind) { return LINE_HEIGHT[kind]; } };
})();
