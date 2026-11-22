/*
 * The done toggle of a log row, as a pure rule: a task becomes done and a done entry becomes a task again. Every other type
 * (event, note, moved, scheduled) stays as it is. No DOM, no fetch.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.done = L.done || {};

  var NEXT = { task: 'done', done: 'task' };

  /** The type a tap on the bullet turns this type into, or null when the bullet does not toggle for it. */
  function next(type) {
    return Object.prototype.hasOwnProperty.call(NEXT, type) ? NEXT[type] : null;
  }

  /** True for an entry whose bullet is a done toggle. */
  function canToggle(entry) {
    return next(entry.type) !== null;
  }

  L.done.model = { next: next, canToggle: canToggle };
})();
