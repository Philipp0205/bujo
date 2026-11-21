/*
 * Boots the rapid log: loads the window of days, renders it, and wires the sheet. Needs every other log file and core.js.
 * The state lives here and nowhere else. While an entry waits for its push to Nextcloud, the log reads its own API again
 * every so often (never Nextcloud) and stops when nothing is pending.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  var root = document.getElementById('log');
  var state = { status: 'loading', entries: [], today: L.dates.todayIso(), focus: null };
  var POLL_MS = 800;
  var pollTimer = null;

  /** The things a row or the add row can do. A note with a body opens the note sheet, any other entry the entry sheet. */
  var actions = {
    open: function (entry) {
      if (L.note.model.isNote(entry)) L.note.sheet.open({ mode: 'saved', values: L.note.model.fromEntry(entry), onSaved: reload });
      else L.sheet.open({ entry: entry, today: state.today, onSaved: reload });
    },
    add: function () { L.sheet.open({ entry: null, today: state.today, onSaved: reload }); },
    scan: function () { L.scan.flow.start({ day: state.today, onApplied: applied }); }
  };

  /** After a scan is applied or a note saved: show the day it landed on, even when it is outside the usual window. */
  function applied(result) {
    state.focus = result.date;
    reload();
  }

  /** The body under the header for the current status. */
  function body() {
    if (state.status === 'ready') return L.view.dayList(state.entries, state.today, actions);
    return L.view.stateNote(state.status, reload);
  }

  /** Redraws the whole page from the state. The page is small, so nothing is patched in place. */
  function render() {
    root.replaceChildren(L.view.header(actions.scan), AppKit.h('div', { class: 'paper-page' }, body()));
  }

  /** Loads the window around today, stretched to the day of the last applied scan. A failed quiet refresh keeps the entries on screen. */
  function load(quiet) {
    state.today = L.dates.todayIso();
    var range = L.dates.windowWith(state.today, state.focus);
    return L.api.list(range.from, range.to).then(function (entries) {
      state.entries = entries;
      state.status = 'ready';
    }, function () {
      if (!quiet) state.status = 'error';
    }).then(function () {
      render();
      watchPending();
    });
  }

  function reload() {
    state.status = 'loading';
    render();
    return load();
  }

  /** True while some entry still waits for its push to Nextcloud. */
  function anyPending() {
    return state.status === 'ready' && state.entries.some(function (entry) { return entry.sync === 'pending'; });
  }

  /** Reads the log again without the loading note, so a dot turns from pending to synced or error on its own. */
  function refreshQuietly() {
    pollTimer = null;
    if (!anyPending()) return;
    load(true);
  }

  /** While an entry is pending, ask the app's own API again soon. With none pending the timer is left off. */
  function watchPending() {
    if (pollTimer !== null || !anyPending()) return;
    pollTimer = window.setTimeout(refreshQuietly, POLL_MS);
  }

  AppKit.themeColor.start();
  AppKit.installPrompt.init({ appName: 'bujo', iconUrl: '/icons/icon-192.png' });
  AppKit.sw.register({ url: '/sw.js', scope: '/' });

  render();
  load();
})();
