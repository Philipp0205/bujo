/*
 * Gesture copy: the words of drag and drop in the daily log (the failure toast). Adds L.copy.gesture to the log copy. Needs log/copy.js.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};

  L.copy.gesture = {
    reorderFailed: 'Could not save the new order. The log is back as it was.'
  };
})();
