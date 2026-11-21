/*
 * Where the on-screen keyboard is. The accessory bar is pinned to the bottom of the visual viewport, and the line being
 * typed is scrolled above it. Without a keyboard (desktop) the gap is 0 and the bar sits at the bottom of the screen.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.inline = L.inline || {};

  var BAR_HEIGHT = 56;
  var MARGIN = 8;

  /** The height the keyboard takes from the bottom of the layout viewport, 0 when there is none. */
  function keyboardGap() {
    var vv = window.visualViewport;
    if (!vv) return 0;
    return Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
  }

  /** Pins the bar just above the keyboard. The home-indicator inset only counts when no keyboard covers it. */
  function place(bar) {
    var gap = keyboardGap();
    bar.style.bottom = gap + 'px';
    bar.style.setProperty('--bar-safe', gap > 0 ? '0px' : 'var(--ak-safe-bottom, 0px)');
  }

  /** Scrolls the page just enough that the node ends above the bar, so the bar never covers the line being typed. */
  function reveal(node) {
    var vv = window.visualViewport;
    var bottom = (vv ? vv.offsetTop + vv.height : window.innerHeight) - BAR_HEIGHT - MARGIN;
    var over = node.getBoundingClientRect().bottom - bottom;
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
