/*
 * The saved choice for sound and haptics, on this device only (localStorage). Off until the person turns it on.
 * A blocked storage is not an error: the choice then lasts until the page closes. Needs feel/model.js.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.feel = L.feel || {};

  var remembered = false;

  /** True when the person turned sound and haptics on. */
  function read() {
    try {
      return L.feel.model.parse(window.localStorage.getItem(L.feel.model.KEY));
    } catch (error) {
      return remembered;
    }
  }

  /** Saves the choice and returns it. */
  function write(enabled) {
    remembered = !!enabled;
    try {
      window.localStorage.setItem(L.feel.model.KEY, L.feel.model.serialize(remembered));
    } catch (error) { /* the choice lasts until the page closes */ }
    return remembered;
  }

  L.feel.store = { read: read, write: write };
})();
