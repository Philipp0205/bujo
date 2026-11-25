/*
 * The "not on paper" sheet: every entry made in the app that was not written on the page yet, by day. It has Copy all (one
 * paper line per entry, to write down from), Mark as written per entry, and for an open task of an earlier day the same Keep,
 * Schedule and Drop as the migration review (migrate/choices.js), plus a dock button that opens the review. Opens at once, inside
 * the tap, and fills when the server answers. Needs ak-dom.js, nav/overlays.js, clipboard.js, toast.js, api.js, migrate/choices.js
 * and the other paper/ files.
 * options: today, onCount(count) once the list is read or shrinks, onChanged() after an entry was marked or migrated,
 * onMigrate() to open the review (the sheet closes first), onClose(),
 * onScan() to start a scan (offered once the last entry was marked as written in this open sheet; the sheet closes first).
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.paper = L.paper || {};

  /** Redraws the sheet from its state: the sub line, the rows, the Copy all button and the Migrate button. */
  function paint(parts, state, handlers) {
    handlers.busy = state.busy;
    parts.sub.textContent = L.paper.view.subText(state);
    parts.slot.replaceChildren.apply(parts.slot, [].concat(L.paper.view.content(state, handlers)));
    parts.copy.disabled = state.status !== 'ready' || !state.entries.length;
    parts.migrate.hidden = !(state.status === 'ready' && state.entries.some(function (entry) { return L.migrate.model.reviewable(entry, state.today); }));
  }

  /** Reads the list into the state and draws it. A failed read shows the failure line. */
  function fill(parts, state, handlers) {
    var range = L.paper.model.range(state.today);
    return L.api.listNotOnPaper(range.from, range.to).then(function (entries) {
      state.entries = entries;
      state.status = 'ready';
    }, function () {
      state.status = 'error';
    }).then(function () { paint(parts, state, handlers); });
  }

  /** Marks one entry as written: it leaves the list. A failure keeps it there and says so. */
  function written(parts, state, options, handlers, entry) {
    return L.api.markWritten(entry.id).then(function () {
      state.entries = L.paper.model.without(state.entries, entry.id);
      state.offer = !state.entries.length && !!options.onScan;
      paint(parts, state, handlers);
      options.onCount(state.entries.length);
      options.onChanged();
    }, function () { L.toast.show(L.copy.paper.writtenFailed, 'fail'); });
  }

  /** One migration choice on a row. A moved entry is not on paper again on its new day, so the list is read again: the row moves or stays. */
  function decide(parts, state, options, handlers, entry, action) {
    if (state.busy) return;
    var settle = function () { state.busy = false; };
    L.migrate.choices.decide(entry, action, state.today, {
      start: function () { state.busy = true; paint(parts, state, handlers); },
      done: function () {
        settle();
        fill(parts, state, handlers).then(function () { if (state.status === 'ready') options.onCount(state.entries.length); });
        options.onChanged();
      },
      fail: function () { settle(); paint(parts, state, handlers); }
    });
  }

  /** Opens the sheet. Returns the kit's handle, or null when another sheet is open. */
  function open(options) {
    var state = { entries: [], status: 'loading', today: options.today, busy: false, offer: false };
    var sheet = null;
    var closeThen = function (next) { return function () { if (sheet) sheet.close(); if (next) next(); }; };
    state.offerActions = { onScan: closeThen(options.onScan), onDismiss: closeThen(null) };
    var parts = L.paper.view.shell(function () { L.clipboard.copy(state.entries); }, function () { sheet.close(); options.onMigrate(); });
    var handlers = { today: options.today, busy: false };
    handlers.written = function (entry) { written(parts, state, options, handlers, entry); };
    handlers.decide = function (entry, action) { decide(parts, state, options, handlers, entry, action); };
    paint(parts, state, handlers);
    sheet = BujoNav.overlays.showSheet(parts.node, { onClose: options.onClose });
    if (sheet) fill(parts, state, handlers).then(function () { if (state.status === 'ready') options.onCount(state.entries.length); });
    return sheet;
  }

  L.paper.sheet = { open: open };
})();
