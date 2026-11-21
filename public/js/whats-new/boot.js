/*
 * What's new boot: decides what to show and wires the close to the seen state. showUnseen is for the rapid log (only entries
 * newer than the merged seen id), showAll is for settings (the full list). Both store the newest id when the sheet closes.
 * Needs catalog.js, seen.js, sheet.js and ak-whats-new.js.
 */
(function () {
  'use strict';

  var W = window.BujoWhatsNew = window.BujoWhatsNew || {};

  /** Opens the sheet for some entries. Closing it stores the newest id of the whole catalog as seen. */
  function present(all, shown, mode) {
    var latest = AppKit.whatsNew.latestId(all);
    return W.sheet.open({
      entries: shown,
      mode: mode,
      onClose: function () { W.seen.remember(latest); }
    });
  }

  /** On boot of the log: shows the entries newer than what this device and the account have seen, if there are any. */
  function showUnseen() {
    return W.catalog.load().then(function (all) {
      return W.seen.current(all).then(function (seen) {
        var fresh = AppKit.whatsNew.unseenEntries(all, seen);
        return fresh.length ? present(all, fresh, 'unseen') : null;
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
