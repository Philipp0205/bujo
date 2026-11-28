/*
 * The hand-drawn tick box: a wobbly pen square with a pen tick, as one small <svg>. The tick shows only while the control around it is
 * on (the CSS reads aria-checked, or :checked of the native input before it), so the control's own semantics do all the work.
 * The seed keeps the wobble of a box the same on every redraw. Needs path.js.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.ink = L.ink || {};

  var NS = 'http://www.w3.org/2000/svg';

  /** One stroke as an svg path in the current ink colour, in a class so the CSS can show or hide the tick. */
  function strokeNode(stroke, name) {
    var path = document.createElementNS(NS, 'path');
    path.setAttribute('class', name);
    path.setAttribute('d', stroke.d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', String(stroke.width));
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('opacity', String(stroke.opacity));
    return path;
  }

  /** A tick box for a seed: a span (the box, aria-hidden) holding the svg of the pen square and the pen tick. */
  function tickBox(seed) {
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    L.ink.path.box(seed).forEach(function (stroke) { svg.appendChild(strokeNode(stroke, 'ink-tick-box')); });
    L.ink.path.tick(seed).forEach(function (stroke) { svg.appendChild(strokeNode(stroke, 'ink-tick-mark')); });
    var box = document.createElement('span');
    box.className = 'ink-tick';
    box.setAttribute('aria-hidden', 'true');
    box.appendChild(svg);
    return box;
  }

  L.ink.tick = { box: tickBox };
})();
