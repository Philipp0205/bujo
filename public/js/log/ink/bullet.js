/*
 * The pen-stroke bullets of the list rows: an <svg> that draws the strokes of ink/bullet-model.js, and the short ink animation that
 * draws them stroke by stroke when the user changes a row (a done x, a moved > or <). DOM only, no fetch.
 * Needs ink/bullet-model.js. The look and the animation are in css/ink-bullets.css.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.ink = L.ink || {};

  var NS = 'http://www.w3.org/2000/svg';
  var DRAW_MS = 260;

  /** One pen stroke as a <path>. pathLength 1 lets the css draw every stroke with the same dash numbers. */
  function pathOf(stroke, index) {
    var path = document.createElementNS(NS, 'path');
    path.setAttribute('d', stroke.d);
    path.setAttribute('stroke-width', String(stroke.width));
    path.setAttribute('pathLength', '1');
    path.style.setProperty('--i', String(index));
    return path;
  }

  /** The <svg> of a bullet type, seeded by the entry id. It is hidden from screen readers: the row or button around it has the name. */
  function node(type, seed) {
    var model = L.ink.bulletModel.strokes(type, seed);
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'ink-bullet');
    svg.setAttribute('viewBox', model.viewBox);
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('data-glyph', type);
    model.strokes.forEach(function (stroke, index) { svg.appendChild(pathOf(stroke, index)); });
    return svg;
  }

  /** Draws the strokes of a bullet one after the other, then drops the animation class. Only the user's own action calls this. */
  function draw(svg) {
    if (!svg) return;
    svg.classList.remove('is-drawing');
    void svg.getBoundingClientRect();
    svg.classList.add('is-drawing');
    window.setTimeout(function () { svg.classList.remove('is-drawing'); }, DRAW_MS + 100);
  }

  /** Draws the bullet of the trace a move just left (a > or <), found by the id of the entry that moved. */
  function drawTrace(entryId) {
    var rows = document.querySelectorAll('.paper-trace[data-entry="' + entryId + '"] .ink-bullet');
    draw(rows[rows.length - 1]);
  }

  L.ink.bullet = { node: node, draw: draw, drawTrace: drawTrace };
})();
