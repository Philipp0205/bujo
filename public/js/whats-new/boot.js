/*
 * What's new boot: decides what to show and wires the close to the seen state. showUnseen is for the rapid log (only entries
 * newer than the merged seen id), showAll is for settings (the full list). Both store the newest id when the sheet closes.
 * Needs catalog.js, seen.js, sheet.js and ak-whats-new.js.
 */
(function () {
  'use strict';

  var W = window.BujoWhatsNew = window.BujoWhatsNew || {};

  /** Opens the sheet for some entries. Closing it stores the newest id of the whole catalog as seen, then runs after (if given). */
  function present(all, shown, mode, after) {
    var latest = AppKit.whatsNew.latestId(all);
    return W.sheet.open({
      entries: shown,
      mode: mode,
      onClose: function () {
        W.seen.remember(latest);
        if (typeof after === 'function') after();
      }
    });
  }

  /** On boot of the log: shows the entries newer than what this device and the account have seen, if there are any.
   * after runs once the sheet is closed, or at once when there is nothing to show (so a later prompt never sits on top of it). */
  function showUnseen(after) {
    return W.catalog.load().then(function (all) {
      return W.seen.current(all).then(function (seen) {
        var fresh = AppKit.whatsNew.unseenEntries(all, seen);
        var sheet = fresh.length ? present(all, fresh, 'unseen', after) : null;
        if (!sheet && typeof after === 'function') after();
        return sheet;
      });
    });
  }

  /** From settings: shows every entry. Resolves false when the catalog is empty. */
  function showAll() {
    return W.catalog.load().then(function (all) {
      if (!all.length) return false;
      return !!present(all, all, 'all');
    });
  }

  W.boot = { showUnseen: showUnseen, showAll: showAll };
})();
