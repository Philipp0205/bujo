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

  /** True for an entry on a real day (the daily log or the monthly calendar) whose bullet is a done toggle. Month-task and future items have no toggle, so none of the gestures act on them. */
  function canToggle(entry) {
    return L.days.hasDay(L.days.horizonOf(entry)) && next(entry.type) !== null;
  }

  L.done.model = { next: next, canToggle: canToggle };
})();
