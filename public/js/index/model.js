/*
 * Pure model of the notebook index: the label of a listed page and where a tap on it goes. No DOM, no fetch.
 * The server lists the pages (GET /api/index, ascending by number); the words for a day or a month are made here.
 * Needs index/copy.js and log/dates.js.
 */
(function () {
  'use strict';

  var I = window.BujoIndex = window.BujoIndex || {};
  var L = window.BujoLog;

  /** The words of a row: "Wed 18.11" (", page 2" for a later page of a day), "March 2027", "Future log, from Mar 2027", or a collection's name. */
  function labelOf(item) {
    var copy = I.copy;
    if (item.kind === 'day') return copy.dayLabel(L.dates.weekdayShort(item.ref), item.ref, item.page);
    if (item.kind === 'month') return copy.monthLabel(item.ref);
    if (item.kind === 'future') return copy.futureLabel(item.ref);
    return item.label || '';
  }

  /**
   * Where a tap goes: { collection: id } for a collection, else the view the log opens on ({ view, date } for a day, { view, month, part }
   * for a month log, { view } for the future log). A day opens on its day: the daily log has no way to open one physical page of a day.
   */
  function targetOf(item) {
    if (item.kind === 'collection') return { collection: item.ref };
    if (item.kind === 'day') return { view: 'daily', date: item.ref };
    if (item.kind === 'month') return { view: 'month', month: item.ref, part: 'calendar' };
    return { view: 'future', month: null };
  }

  I.model = { labelOf: labelOf, targetOf: targetOf };
})();
