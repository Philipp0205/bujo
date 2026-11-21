/*
 * Boots the rapid log: loads the window of days, renders it, and wires the inline editor and the sheets. Needs every other
 * log file and core.js. The state lives here and nowhere else. While an entry waits for its push to Nextcloud, the log
 * reads its own API again every so often (never Nextcloud) and stops when nothing is pending. It also asks the
 * what's-new boot to show entries the person has not seen yet.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  var root = document.getElementById('log');
  var state = { status: 'loading', entries: [], today: L.dates.todayIso(), focus: null, version: 0 };
  var POLL_MS = 800;
  var pollTimer = null;

  /** The things a card or the add row can do. A note with a body opens the note sheet, any other entry opens the edit sheet. */
  var actions = {
    open: function (entry) {
      if (L.note.model.isNote(entry)) L.inline.editor.settle(function () { openNote(entry); });
      else L.inline.editor.editEntry(entry);
    },
    add: function () { L.inline.editor.addLine(); },
    scan: function () { L.scan.flow.start({ day: state.today, onApplied: applied }); }
  };

  function openNote(entry) {
    L.note.sheet.open({ mode: 'saved', values: L.note.model.fromEntry(entry), onSaved: reload });
  }

  /** What the inline editor needs from the page: the day, a redraw, saved entries and the details sheet. */
  var host = {
    today: function () { return state.today; },
    draw: draw,
    upsert: upsert,
    replaceDay: replaceDay,
    dayEntries: function (date) { return L.days.dayEntries(state.entries, date); },
    openSheet: function (entry) { L.sheet.open({ entry: entry, today: state.today, onSaved: reload }); }
  };

  /** Swaps every entry of one day for the server's list of that day (after a delete or a move). */
  function replaceDay(date, entries) {
    state.entries = state.entries.filter(function (entry) { return entry.date !== date; }).concat(entries);
    state.status = 'ready';
    state.version += 1;
  }

  /** Keeps the entries in step with an entry the editor just saved: replaced in place, or added at the end.
   * The version bump makes a read that was already in flight start over, so it cannot hide the saved entry. */
  function upsert(entry) {
    var at = state.entries.findIndex(function (item) { return item.id === entry.id; });
    if (at >= 0) state.entries[at] = entry;
    else state.entries.push(entry);
    state.status = 'ready';
    state.version += 1;
    watchPending();
  }

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

  /** Draws the whole page from the state, then inks its cards. The page is small, so nothing is patched in place. */
  function draw() {
    root.replaceChildren(L.view.header(actions.scan), AppKit.h('div', { class: 'paper-page' }, body()));
    L.ink.decorate.list(root);
  }

  /** Redraws through the editor, which puts the line being typed back with its draft and focus. */
  function render() {
    L.inline.editor.paint();
  }

  /** A tap on the paper itself (not on a row, heading or button) starts a line, like a text document. */
  function onPaperTap(event) {
    var target = event.target;
    var bare = target === root || target.classList.contains('paper-page') || target.hasAttribute('data-today');
    if (bare && state.status === 'ready') L.inline.editor.addLine();
  }

  /** Loads the window around today, stretched to the day of the last applied scan. A failed quiet refresh keeps the entries on screen. */
  function load(quiet) {
    state.today = L.dates.todayIso();
    var range = L.dates.windowWith(state.today, state.focus);
    var seen = state.version;
    return L.api.list(range.from, range.to).then(function (entries) {
      if (seen !== state.version) return;
      state.entries = entries;
      state.status = 'ready';
    }, function () {
      if (!quiet) state.status = 'error';
    }).then(function () {
      render();
      watchPending();
      if (seen !== state.version) load(true);
    });
  }

  /** Reads the log again with the loading note. Never used while a line is being typed. */
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

  L.inline.editor.init(host);
  root.addEventListener('click', onPaperTap);
  render();
  load();
  BujoWhatsNew.boot.showUnseen({ paper: true });
})();
