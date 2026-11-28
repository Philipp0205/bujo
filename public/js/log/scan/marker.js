/*
 * The hand-drawn marker views (and the heading squiggle): an <svg> that draws a scribble from scan/scribble.js. Needs scan/scribble.js.
 * The svg takes its color from the row (currentColor) and does not catch touches.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.scan = L.scan || {};
  var NS = 'http://www.w3.org/2000/svg';

  /** An svg with one path per pen pass. The box is stretched to the element, the pen width is not. */
  function draw(shape, cls) {
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', cls);
    svg.setAttribute('viewBox', shape.viewBox);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    shape.strokes.forEach(function (stroke) {
      var path = document.createElementNS(NS, 'path');
      path.setAttribute('d', stroke.d);
      path.setAttribute('stroke-width', String(stroke.width));
      svg.appendChild(path);
    });
    return svg;
  }

  /** The loop drawn around a title or a legend swatch. */
  function pill(seed) {
    return draw(L.scan.scribble.pill(seed), 'scan-scribble');
  }

  /** The circle drawn around a bullet. */
  function ring(seed) {
    return draw(L.scan.scribble.ring(seed), 'scan-ring');
  }

  /** The small pen icon of the match button: a cross-out, or the "again" arrow once the line was un-matched. */
  function icon(kind, seed) {
    return draw(L.scan.scribble[kind](seed), 'scan-hand-icon');
  }

  /** The pen arrow (or, for a collection, the short branch line) drawn between the words of the type picker. */
  function link(kind, seed) {
    return draw(L.scan.scribble[kind](seed), 'scan-link');
  }

  /** The wavy pen line under a heading. */
  function squiggle(seed) {
    return draw(L.scan.scribble.squiggle(seed), 'hand-squiggle');
  }

  L.scan.marker = { pill: pill, ring: ring, icon: icon, link: link, squiggle: squiggle };
})();
