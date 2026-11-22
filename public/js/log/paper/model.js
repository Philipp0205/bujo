/*
 * Pure model of the "not on paper" list: which days it reads and how its entries group. No DOM, no fetch, no words.
 * Needs dates.js, days.js and paper/recent.js.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.paper = L.paper || {};

  /** Months read after this one, so month-tasks and future items that are not on paper still show. */
  var MONTHS_AHEAD = 5;

  /** The days the list covers: the paper window back, through the end of the sixth month (this one and five more). The server caps a read at 200 days, and this stays under it (about 198 at most). */
  function range(today) {
    return { from: L.paper.recent.first(today), to: L.dates.monthEnd(today, MONTHS_AHEAD) };
  }

  /** The entries of one month group: the month-tasks, then the future items, each in its own order. */
  function monthItems(entries, date) {
    return L.days.groupEntries(entries, 'month-task', date).concat(L.days.groupEntries(entries, 'future', date));
  }

  /** The groups the entries sit in: [{ date, month, entries }]. A month group is dated by its month's last day, and a day group comes first on the same date. */
  function groups(entries) {
    var seen = {};
    entries.forEach(function (entry) {
      var month = L.days.horizonOf(entry) !== 'day';
      seen[(month ? 'm' : 'd') + entry.date] = { date: entry.date, month: month };
    });
    return Object.keys(seen).map(function (key) { return seen[key]; }).sort(function (a, b) {
      return a.date < b.date ? -1 : a.date > b.date ? 1 : Number(a.month) - Number(b.month);
    }).map(function (group) {
      return { date: group.date, month: group.month, entries: group.month ? monthItems(entries, group.date) : L.days.dayEntries(entries, group.date) };
    });
  }

  /** The entries without the one with this id (it was marked as written). */
  function without(entries, id) {
    return entries.filter(function (entry) { return entry.id !== id; });
  }

  L.paper.model = { range: range, groups: groups, without: without };
})();
