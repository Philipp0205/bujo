/*
 * The page numbers the person chose to skip (blank pages and the like), kept on this device only (localStorage, one key: the
 * client knows no user id). Never sent to the server or to CalDAV. A blocked or damaged storage never throws: nothing is skipped.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.gap = L.gap || {};

  var KEY = 'bujo-page-gap-skipped';

  /** The skipped page numbers, ascending and unique; empty when none are stored or storage is blocked. */
  function list() {
    try {
      var raw = JSON.parse(window.localStorage.getItem(KEY) || '[]');
      return Array.isArray(raw) ? raw.filter(L.gap.model.valid) : [];
    } catch (e) {
      return [];
    }
  }

  /** Adds page numbers to the skipped ones and keeps them. Blocked storage is ignored. */
  function skip(numbers) {
    var all = list().concat(numbers).filter(function (number, at, whole) { return whole.indexOf(number) === at; });
    all.sort(function (a, b) { return a - b; });
    try { window.localStorage.setItem(KEY, JSON.stringify(all)); } catch (e) { /* the pages will be asked for again */ }
  }

  L.gap.store = { list: list, skip: skip };
})();
