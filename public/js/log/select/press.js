/*
 * The long press on a log row: hold for about half a second without moving to start selecting. The press itself is owned by
 * gesture/hold.js (it tells a held-still row from a scroll, a swipe and a drag, and eats the click after a long press, so letting go
 * never opens the editor). This file only subscribes select mode to that hook (L.gesture.hold.onHeldStill). Needs gesture/hold.js.
 * options: onHold(id) with the data-id of the held row.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.select = L.select || {};

  /** Starts listening for held-still rows. Call once. */
  function init(options) {
    L.gesture.hold.onHeldStill(function (id) { options.onHold(id); });
  }

  L.select.press = { init: init };
})();
