/*
 * The four tab icons (the plus of Add included) as inline SVG nodes, drawn with the same fine pen line as the paper glyphs.
 * They are built here, not taken from the sprite of the rapid log, so every page that shows the bar (the log, Notes, Settings)
 * has them. The kit adds ak-tab-icon.
 */
(function () {
  'use strict';

  var N = window.BujoNav = window.BujoNav || {};
  var NS = 'http://www.w3.org/2000/svg';

  /** The parts of each icon: [element, attributes]. Strokes use the text colour, so the tab colour decides the ink. */
  var PARTS = {
    log: [
      ['circle', { cx: 5.5, cy: 7, r: 1.2, fill: 'currentColor', stroke: 'none' }],
      ['circle', { cx: 5.5, cy: 12, r: 1.2, fill: 'currentColor', stroke: 'none' }],
      ['circle', { cx: 5.5, cy: 17, r: 1.2, fill: 'currentColor', stroke: 'none' }],
      ['path', { d: 'M10 7h9M10 12h9M10 17h9' }]
    ],
    notes: [
      ['path', { d: 'M7 3.75h7.2L19 8.55V19a1.25 1.25 0 0 1-1.25 1.25H7A1.25 1.25 0 0 1 5.75 19V5A1.25 1.25 0 0 1 7 3.75z' }],
      ['path', { d: 'M14 3.9v4.7h4.7M9 13h6M9 16.5h4' }]
    ],
    add: [
      ['path', { d: 'M12 5.5v13M5.5 12h13' }]
    ],
    account: [
      ['circle', { cx: 12, cy: 8.5, r: 3.25 }],
      ['path', { d: 'M5.5 19.75c.7-3.5 3.3-5.25 6.5-5.25s5.8 1.75 6.5 5.25' }]
    ]
  };

  /** A new <svg> node for the tab with this id. */
  function icon(id) {
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.5');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    PARTS[id].forEach(function (part) {
      var node = document.createElementNS(NS, part[0]);
      Object.keys(part[1]).forEach(function (key) { node.setAttribute(key, String(part[1][key])); });
      svg.appendChild(node);
    });
    return svg;
  }

  N.icons = { icon: icon };
})();
