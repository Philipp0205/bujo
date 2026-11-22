/*
 * Pure model of the Future and Month views: which months they cover, the range they read, where a new line goes, and how entries group
 * under a month. No DOM, no fetch, no strings to show. Needs dates.js, days.js and pages/model.js (shiftMonth).
 *
 * The three views are 'future', 'month' and 'daily'. Future and Month share one read: the first day of this month through the end
 * of the sixth month (this month and five more). A month-task or future item is dated by the last day of its month, so it sorts
 * after every day of that month.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.horizon = L.horizon || {};

  var VIEWS = ['future', 'month', 'daily'];
  var MONTHS_SHOWN = 6;
  var MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

  /** True for a view name the log knows. */
  function isView(name) {
    return VIEWS.indexOf(name) >= 0;
  }

  /** The months of the Future Log: this month and the five after it, as YYYY-MM. */
  function futureMonths(today) {
    var first = L.pages.model.monthOf(today);
    var months = [];
    for (var step = 0; step < MONTHS_SHOWN; step += 1) months.push(L.pages.model.shiftMonth(first, step));
    return months;
  }

  /** The days Future and Month read: the first of this month through the end of the sixth month. */
  function span(today) {
    return { from: L.dates.monthStart(today), to: L.dates.monthEnd(today, MONTHS_SHOWN - 1) };
  }

  /** The last day of a month (YYYY-MM): the date a month-task or future item of that month carries. */
  function lastDay(month) {
    return L.dates.monthEnd(month + '-01', 0);
  }

  /** A ?month= value as a month the views can show, else null. */
  function readMonth(text, today) {
    if (typeof text !== 'string' || !MONTH.test(text)) return null;
    return futureMonths(today).indexOf(text) >= 0 ? text : null;
  }

  /** The month n months from a month when that month is one of the six, else null (the arrows stop at the ends). */
  function shifted(month, n, today) {
    var next = L.pages.model.shiftMonth(month, n);
    return futureMonths(today).indexOf(next) >= 0 ? next : null;
  }

  /** Where a new line goes while a view is open: { date, horizon }. Month files under the month on screen (a month-task this month, a
   * future item later), Future under the month after this one, which a written @month or the Date key can change. */
  function slotOf(view, month, today) {
    var target = view === 'future' ? L.pages.model.shiftMonth(L.pages.model.monthOf(today), 1) : month;
    return { date: lastDay(target), horizon: target <= L.pages.model.monthOf(today) ? 'month-task' : 'future' };
  }

  /** The days of a month with something on them, in date order: [{ date, entries, traces }]. A day with only a trace is listed too. */
  function monthDays(entries, month) {
    var seen = {};
    entries.forEach(function (entry) {
      if (L.days.horizonOf(entry) === 'day' && L.pages.model.monthOf(entry.date) === month) seen[entry.date] = true;
    });
    return Object.keys(seen).sort().map(function (date) {
      return { date: date, entries: L.days.dayEntries(entries, date), traces: L.days.tracesOf(entries, 'day', date) };
    });
  }

  /** The cards of the entries filed under a whole month: the month-tasks first, then the future items, each group in its own order. */
  function monthCards(entries, month) {
    var date = lastDay(month);
    var groups = ['month-task', 'future'].map(function (horizon) { return L.days.groupEntries(entries, horizon, date); });
    return groups.reduce(function (cards, group) { return cards.concat(L.days.cardsOf(group)); }, []);
  }

  /** The traces left on the lanes of a whole month (month tasks and future items), after the entries. */
  function monthTraces(entries, month) {
    var date = lastDay(month);
    return ['month-task', 'future'].reduce(function (all, horizon) { return all.concat(L.days.tracesOf(entries, horizon, date)); }, []);
  }

  /** The six buckets of the Future Log: [{ month, cards, traces }], this month first. */
  function buckets(entries, today) {
    return futureMonths(today).map(function (month) {
      return { month: month, cards: monthCards(entries, month), traces: monthTraces(entries, month) };
    });
  }

  L.horizon.model = {
    VIEWS: VIEWS, isView: isView, futureMonths: futureMonths, span: span, lastDay: lastDay, readMonth: readMonth, shifted: shifted,
    slotOf: slotOf, monthDays: monthDays, monthCards: monthCards, monthTraces: monthTraces, buckets: buckets
  };
})();
