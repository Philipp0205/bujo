/*
 * Pure model of the "not on paper" list: which days it reads and how its entries group. No DOM, no fetch, no words.
 * Needs dates.js and days.js.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.paper = L.paper || {};

  /** Days read before and after today: 70 + 21 + today is 92 days, the longest range the server lists. */
  var BACK_DAYS = 70;
  var AHEAD_DAYS = 21;

  /** The days the list covers: wider than the log window, because an entry from last month may still wait for the page. */
  function range(today) {
    return { from: L.dates.addDays(today, -BACK_DAYS), to: L.dates.addDays(today, AHEAD_DAYS) };
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
