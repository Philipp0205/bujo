/*
 * Pure model of the migration review: which entries it asks about, and the tally it ends with. No DOM, no fetch, no words.
 * Only an open task of the daily log from a day before today is reviewed: not done, notes, events, moved, scheduled or dropped
 * marks, traces, the monthly calendar, month tasks or future items. Needs days.js.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.migrate = L.migrate || {};

  /** True for an entry the review asks about. */
  function reviewable(entry, today) {
    return !entry.isTrace && entry.type === 'task' && L.days.horizonOf(entry) === 'day' && entry.date < today;
  }

  /** The open tasks of earlier days, oldest day first and in page order within a day. */
  function open(entries, today) {
    return entries.filter(function (entry) { return reviewable(entry, today); }).sort(function (a, b) {
      return a.date < b.date ? -1 : a.date > b.date ? 1 : L.days.compare(a, b);
    });
  }

  /** The tally of a review: how many were kept, scheduled and dropped. */
  function tally(decisions) {
    var count = { kept: 0, scheduled: 0, dropped: 0 };
    decisions.forEach(function (decision) { count[decision] += 1; });
    return count;
  }

  L.migrate.model = { open: open, tally: tally };
})();
