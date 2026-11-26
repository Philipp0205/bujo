/*
 * The page numbers the person chose to skip (blank pages and the like), kept per notebook on this device only (localStorage, one
 * key per notebook id: the client knows no user id). A notebook restarts at page 1, so a skip never reaches another notebook. The
 * old single key of the first release counts as the skips of the FIRST notebook until that notebook has a key of its own. Never
 * sent to the server or to CalDAV. A blocked or damaged storage never throws: nothing is skipped.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.gap = L.gap || {};

  var LEGACY_KEY = 'bujo-page-gap-skipped';

  /** The storage key of one notebook. */
  function keyOf(notebookId) {
    return LEGACY_KEY + ':' + notebookId;
  }

  /** The numbers under one key, ascending as stored; null when the key is absent; empty when it is damaged or storage is blocked. */
  function read(key) {
    try {
      var text = window.localStorage.getItem(key);
      if (text === null) return null;
      var raw = JSON.parse(text);
      return Array.isArray(raw) ? raw.filter(L.gap.model.valid) : [];
    } catch (e) {
      return [];
    }
  }

  /** The skipped page numbers of a notebook, ascending and unique. `first` says it is the first notebook, which inherits the old key. */
  function list(notebookId, first) {
    var own = read(keyOf(notebookId));
    if (own !== null) return own;
    return first ? read(LEGACY_KEY) || [] : [];
  }

  /** Adds page numbers to the skipped ones of a notebook and keeps them. Blocked storage is ignored. */
  function skip(notebookId, first, numbers) {
    var all = list(notebookId, first).concat(numbers).filter(function (number, at, whole) { return whole.indexOf(number) === at; });
    all.sort(function (a, b) { return a - b; });
    try { window.localStorage.setItem(keyOf(notebookId), JSON.stringify(all)); } catch (e) { /* the pages will be asked for again */ }
  }

  L.gap.store = { list: list, skip: skip };
})();
