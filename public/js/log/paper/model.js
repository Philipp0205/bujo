/*
 * Pure model of the "not on paper" list: which days it reads and how its entries group. No DOM, no fetch, no words.
 * Needs dates.js, days.js and paper/recent.js.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.paper = L.paper || {};

  /** Days read after today, so upcoming unwritten entries still show. The lookback is the paper window (recent.js). */
  var AHEAD_DAYS = 21;

  /** The days the list covers: the paper window back, a modest span ahead. Always inside the server's 92 day cap. */
  function range(today) {
    return { from: L.paper.recent.first(today), to: L.dates.addDays(today, AHEAD_DAYS) };
  }

  /** The entries grouped by day, oldest day first like the log, each day in its own order. */
  function groups(entries) {
    var dates = {};
    entries.forEach(function (entry) { dates[entry.date] = true; });
    return Object.keys(dates).sort().map(function (date) {
      return { date: date, entries: L.days.dayEntries(entries, date) };
    });
  }

  /** The entries without the one with this id (it was marked as written). */
  function without(entries, id) {
    return entries.filter(function (entry) { return entry.id !== id; });
  }

  L.paper.model = { range: range, groups: groups, without: without };
})();
