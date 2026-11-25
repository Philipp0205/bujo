/*
 * The log reminders' memory, kept on this device only (localStorage). The monthly-log nudge after a migration shows at most once a
 * day, the future-log nudge at most once a calendar month. Each stores the day (YYYY-MM-DD) or month (YYYY-MM) it was dismissed on.
 * A blocked storage never throws: nothing is remembered, so the nudge simply shows again. No DOM, no fetch.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.remind = L.remind || {};

  var MONTHLY_KEY = 'bujo-remind-month';
  var FUTURE_KEY = 'bujo-remind-future';

  /** The stored value of a key, or '' when there is none or storage is blocked. */
  function read(key) {
    try { return window.localStorage.getItem(key) || ''; } catch (e) { return ''; }
  }

  /** Keeps a value on this device. Blocked storage is ignored. */
  function write(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) { /* the nudge will just show again */ }
  }

  /** The month (YYYY-MM) of a day (YYYY-MM-DD). */
  function monthOf(today) {
    return String(today).slice(0, 7);
  }

  /** True when the monthly-log nudge may show: it was not dismissed today. */
  function monthlyDue(today) {
    return read(MONTHLY_KEY) !== today;
  }

  /** True when the future-log nudge may show: it was not dismissed in this calendar month. */
  function futureDue(today) {
    return read(FUTURE_KEY) !== monthOf(today);
  }

  /** Records that the monthly-log nudge is done for today. */
  function dismissMonthly(today) {
    write(MONTHLY_KEY, today);
  }

  /** Records that the future-log nudge is done for this month. */
  function dismissFuture(today) {
    write(FUTURE_KEY, monthOf(today));
  }

  L.remind.store = { monthlyDue: monthlyDue, futureDue: futureDue, dismissMonthly: dismissMonthly, dismissFuture: dismissFuture };
})();
