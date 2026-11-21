/*
 * Whether the soft keyboard has closed on the edit sheet. The accessory bar belongs to the keyboard, so it goes with it.
 * A keyboard counts only after it was seen (the gap above the screen bottom grew past a clear height). Desktop and tests have
 * no keyboard, the gap stays 0, and the bar stays. Needs viewport.js. It reads the viewport and keeps two flags, nothing else.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.inline = L.inline || {};

  var OPEN_PX = 100;
  var CLOSED_PX = 20;
  var seen = false;
  var closed = false;

  /** Reads the keyboard gap and says whether a keyboard that was up has gone, so the bar must hide. A gap in between changes nothing. */
  function track() {
    var gap = L.inline.viewport.keyboardGap();
    if (gap > OPEN_PX) {
      seen = true;
      closed = false;
    } else if (seen && gap < CLOSED_PX) {
      seen = false;
      closed = true;
    }
    return closed;
  }

  /** A new edit starts with the bar shown. A keyboard that is up right now still counts, so its closing is noticed later. */
  function reset() {
    seen = L.inline.viewport.keyboardGap() > OPEN_PX;
    closed = false;
  }

  /** True while a keyboard that was seen is believed to be up. */
  function isUp() {
    return seen;
  }

  L.inline.keyboard = { track: track, reset: reset, isUp: isUp, isClosed: function () { return closed; } };
})();
