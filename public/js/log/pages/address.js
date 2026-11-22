/*
 * The ?day= address of the daily pages: reads the day a link asks for, and keeps the address in step with the page on screen
 * (replaceState, so turning pages never adds history entries). Today has no ?day=. Other parameters of the address are left alone.
 * Needs nothing but the DOM and history. A history entry of an open overlay (a picker closing) still sits under the address for a
 * moment, and replacing it would put the address on the wrong entry, so the write waits until that entry is gone.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.pages = L.pages || {};

  var LOG_PATHS = ['/', '/index.html'];
  var WAIT_MS = 40;
  var TRIES = 25;

  var wanted = null;
  var timer = null;

  /** The raw ?day= value of the address, or null. */
  function read() {
    return new URLSearchParams(window.location.search).get('day');
  }

  /** True while the address is the log's own (the tab pages share one document, so another tab must keep its address). */
  function onLog() {
    return LOG_PATHS.indexOf(window.location.pathname) >= 0;
  }

  /** The query for a page: the current one with ?day= set, or taken out for today. */
  function queryFor(date, today) {
    var params = new URLSearchParams(window.location.search);
    if (date === today) params.delete('day');
    else params.set('day', date);
    var text = params.toString();
    return text ? '?' + text : '';
  }

  /** True when the current history entry belongs to an open overlay. */
  function onOverlayEntry() {
    var state = window.history.state;
    return !!(state && state.akOverlay);
  }

  /** Writes the wanted address now, or tries again shortly when an overlay entry is still current. */
  function attempt(tries) {
    timer = null;
    if (!wanted || !onLog()) return;
    if (onOverlayEntry() && tries > 0) { timer = window.setTimeout(function () { attempt(tries - 1); }, WAIT_MS); return; }
    var query = queryFor(wanted.date, wanted.today);
    if (window.location.search === query) return;
    window.history.replaceState(window.history.state, '', window.location.pathname + query + window.location.hash);
  }

  /** Asks for the address of the page on screen. The newest request wins. */
  function sync(date, today) {
    wanted = { date: date, today: today };
    if (timer === null) attempt(TRIES);
  }

  L.pages.address = { read: read, sync: sync };
})();
