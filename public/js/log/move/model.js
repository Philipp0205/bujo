/*
 * Pure model of a move across the logs: which places an entry can go to, and what a pick does to a line. No DOM, no fetch, no words.
 * A place is { key, horizon, date }: a day ('day:YYYY-MM-DD') or a whole month ('month:YYYY-MM', dated by its last day, a month-task for
 * this month and a future item for a later one). An entry on the monthly calendar sits in its own place ('calendar:YYYY-MM-DD'), which the
 * chooser never offers as a target. A line is the model of inline/model.js. A move is "migrate" (the > mark, an entry
 * goes on to another page) or "schedule" (the < mark, an entry is set for a later day or month). Needs dates.js, days.js and horizon/model.js.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.move = L.move || {};

  var KINDS = { migrate: 'migrated', schedule: 'scheduled' };
  /** The types a move turns into a plain task (or, for a schedule onto a day, into a scheduled one). */
  var MOVABLE = ['task', 'migrated', 'scheduled'];

  /** The key of a place a line (or an entry) sits in: its day, its day on the monthly calendar, or its month. */
  function groupKey(horizon, date) {
    if (horizon === 'day') return 'day:' + date;
    return horizon === 'month-calendar' ? 'calendar:' + date : 'month:' + date.slice(0, 7);
  }

  /** A day as a place. */
  function dayPlace(date) {
    return { key: 'day:' + date, horizon: 'day', date: date };
  }

  /** A whole month as a place: a month-task for this month (or an earlier one), a future item for a later month. */
  function monthPlace(month, today) {
    var horizon = month <= today.slice(0, 7) ? 'month-task' : 'future';
    return { key: 'month:' + month, horizon: horizon, date: L.horizon.model.lastDay(month) };
  }

  /** The key of the place a line is in now (the token path may have filed it already). */
  function currentKey(line) {
    return groupKey(line.horizon, line.date);
  }

  /** The key of the place a line started in. */
  function homeKey(line) {
    return groupKey(line.homeHorizon, line.home);
  }

  /** The day after the one an entry is on, but never a day already gone: from a month the next day is tomorrow. */
  function nextDay(line, today) {
    var tomorrow = L.dates.addDays(today, 1);
    if (!L.days.hasDay(line.homeHorizon)) return tomorrow;
    var after = L.dates.addDays(line.home, 1);
    return after < today ? today : after;
  }

  /** The months a line can go to: this month and the five after it, but not the one it is in. */
  function months(line, today) {
    return L.horizon.model.futureMonths(today).map(function (month) { return monthPlace(month, today); }).filter(function (place) {
      return place.key !== homeKey(line);
    });
  }

  /** The day today as a place for a migration, or null when it is not a migration or the entry is on today's page already. */
  function todayPlace(line, kind, today) {
    var place = dayPlace(today);
    return kind === 'migrate' && place.key !== homeKey(line) ? place : null;
  }

  /**
   * What the chooser offers for a saved line: { here, today, next, thisMonth, months }. here is true for a schedule of an entry on a day (the
   * old "this day": the entry stays and only its type changes). today is the page of today for a migration (not "this day": the entry leaves
   * its page). thisMonth is null when the entry is already in this month's list.
   */
  function options(line, kind, today) {
    var thisMonth = monthPlace(today.slice(0, 7), today);
    var next = dayPlace(nextDay(line, today));
    return {
      here: kind === 'schedule' && L.days.hasDay(line.homeHorizon),
      today: todayPlace(line, kind, today),
      next: next.key === homeKey(line) ? null : next,
      thisMonth: thisMonth.key === homeKey(line) ? null : thisMonth,
      months: months(line, today).filter(function (place) { return place.key !== thisMonth.key; })
    };
  }

  /** The type a moved entry takes: a migration makes a plain task of a moved or scheduled mark, a schedule makes a scheduled mark of a task. */
  function typeAfter(line, kind, place) {
    if (MOVABLE.indexOf(line.type) < 0) return line.type;
    if (kind === 'migrate' || place.horizon !== 'day') return 'task';
    return 'scheduled';
  }

  /** A line takes the place: its date, horizon and type change, and a nesting does not follow it to a new page. */
  function place(line, kind, target) {
    if (target.key !== currentKey(line)) line.indent = 0;
    line.date = target.date;
    line.horizon = target.horizon;
    line.type = typeAfter(line, kind, target);
  }

  /** The line stays on the page it came from and its type is set: "this day" of a schedule. No trace, the entry did not leave its page. */
  function stay(line) {
    line.date = line.home;
    line.horizon = line.homeHorizon;
    line.type = typeAfter(line, 'schedule', dayPlace(line.home));
    line.trace = null;
  }

  /**
   * A pick in the chooser, put on the line. target is a place, or null for "this day". Going to the page the line is on only sets the
   * type (a migration to the same page changes nothing). A real move leaves a trace on the page the line came from.
   */
  function apply(line, kind, target) {
    if (!target || target.key === homeKey(line)) {
      if (kind === 'schedule') stay(line);
      return;
    }
    place(line, kind, target);
    line.trace = KINDS[kind];
  }

  /** The place a line was filed in by a written @day or @month (so the chooser can show it as the pick), or null while it is at home. */
  function filedKey(line) {
    return currentKey(line) === homeKey(line) ? null : currentKey(line);
  }

  L.move.model = { KINDS: KINDS, options: options, apply: apply, filedKey: filedKey, dayPlace: dayPlace, groupKey: groupKey };
})();
