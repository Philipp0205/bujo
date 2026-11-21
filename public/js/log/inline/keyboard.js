/*
 * Whether the soft keyboard has just been dismissed under the edit sheet. On Android the system Back first closes the keyboard
 * and fires no popstate, so the editor treats that dismissal as the Back that closes the sheet too.
 * A keyboard counts only after it was seen (the gap above the screen bottom grew past a clear height). Desktop and tests have
 * no keyboard, the gap stays 0, and nothing is ever dismissed. Needs viewport.js. It reads the viewport and keeps one flag.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.inline = L.inline || {};

  var OPEN_PX = 100;
  var CLOSED_PX = 20;
  var seen = false;

  /** Reads the keyboard gap. True only on the reading where a keyboard that was up has gone. A gap in between changes nothing. */
  function track() {
    var gap = L.inline.viewport.keyboardGap();
    if (gap > OPEN_PX) {
      seen = true;
    } else if (seen && gap < CLOSED_PX) {
      seen = false;
      return true;
    }
    return false;
  }

  /** A new edit starts here. A keyboard that is up right now still counts, so its dismissal is noticed later. */
  function reset() {
    seen = L.inline.viewport.keyboardGap() > OPEN_PX;
  }

  L.inline.keyboard = { track: track, reset: reset };
})();
