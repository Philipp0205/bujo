/*
 * Where the on-screen keyboard is. The edit sheet is pinned to the bottom of the visual viewport, and the card being edited
 * is scrolled above it. Without a keyboard (desktop) the gap is 0 and the sheet sits at the bottom of the screen.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.inline = L.inline || {};

  var MARGIN = 12;

  /** The height the keyboard takes from the bottom of the layout viewport, 0 when there is none. */
  function keyboardGap() {
    var vv = window.visualViewport;
    if (!vv) return 0;
    return Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
  }

  /** Pins the sheet just above the keyboard. The home-indicator inset only counts when no keyboard covers it. */
  function place(sheet) {
    var gap = keyboardGap();
    sheet.style.bottom = gap + 'px';
    sheet.style.setProperty('--sheet-safe', gap > 0 ? '0px' : 'var(--ak-safe-bottom, 0px)');
  }

  /** Scrolls the page just enough that the node ends above the sheet, so the sheet never covers what is being edited. */
  function reveal(node, sheet) {
    var vv = window.visualViewport;
    var floor = (vv ? vv.offsetTop + vv.height : window.innerHeight) - sheet.offsetHeight - MARGIN;
    var over = node.getBoundingClientRect().bottom - floor;
    if (over > 0) window.scrollBy(0, over);
  }

  /** Calls onChange whenever the visual viewport moves or resizes (the keyboard opens, closes, or the page scrolls). */
  function follow(onChange) {
    if (!window.visualViewport) return;
    window.visualViewport.addEventListener('resize', onChange);
    window.visualViewport.addEventListener('scroll', onChange);
  }

  L.inline.viewport = { place: place, reveal: reveal, follow: follow };
})();
