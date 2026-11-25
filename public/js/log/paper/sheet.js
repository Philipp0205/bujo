/*
 * The "not on paper" sheet: every entry made in the app that was not written on the page yet, by day. It has Copy all (one
 * paper line per entry, to write down from) and Mark as written per entry. Opens at once, inside the tap, and fills when the
 * server answers. Needs ak-dom.js, nav/overlays.js, clipboard.js, toast.js, api.js and the other paper/ files.
 * options: today, onCount(count) once the list is read or shrinks, onChanged() after an entry was marked, onClose(),
 * onScan() to start a scan (offered once the last entry was marked as written in this open sheet; the sheet closes first).
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.paper = L.paper || {};

  /** Redraws the sheet from its state: the sub line, the rows and the Copy all button. */
  function paint(parts, state, onWritten) {
    parts.sub.textContent = L.paper.view.subText(state);
    parts.slot.replaceChildren.apply(parts.slot, [].concat(L.paper.view.content(state, onWritten, state.offerActions)));
    parts.copy.disabled = state.status !== 'ready' || !state.entries.length;
  }

  /** Reads the list into the state and draws it. A failed read shows the failure line. */
  function fill(parts, state, today, onWritten) {
    var range = L.paper.model.range(today);
    return L.api.listNotOnPaper(range.from, range.to).then(function (entries) {
      state.entries = entries;
      state.status = 'ready';
    }, function () {
      state.status = 'error';
    }).then(function () { paint(parts, state, onWritten); });
  }

  /** Marks one entry as written: it leaves the list. A failure keeps it there and says so. */
  function written(parts, state, options, entry) {
    var redraw = function () { paint(parts, state, onWrittenOf(parts, state, options)); };
    return L.api.markWritten(entry.id).then(function () {
      state.entries = L.paper.model.without(state.entries, entry.id);
      state.offer = !state.entries.length && !!options.onScan;
      redraw();
      options.onCount(state.entries.length);
      options.onChanged();
    }, function () { L.toast.show(L.copy.paper.writtenFailed, 'fail'); });
  }

  /** The click handler of a row's button. */
  function onWrittenOf(parts, state, options) {
    return function (entry) { written(parts, state, options, entry); };
  }

  /** Opens the sheet. Returns the kit's handle, or null when another sheet is open. */
  function open(options) {
    var state = { entries: [], status: 'loading', offer: false };
    var sheet = null;
    var closeThen = function (next) { return function () { if (sheet) sheet.close(); if (next) next(); }; };
    state.offerActions = { onScan: closeThen(options.onScan), onDismiss: closeThen(null) };
    var parts = L.paper.view.shell(function () { L.clipboard.copy(state.entries); });
    var onWritten = onWrittenOf(parts, state, options);
    paint(parts, state, onWritten);
    sheet = BujoNav.overlays.showSheet(parts.node, { onClose: options.onClose });
    if (sheet) fill(parts, state, options.today, onWritten).then(function () { if (state.status === 'ready') options.onCount(state.entries.length); });
    return sheet;
  }

  L.paper.sheet = { open: open };
})();
