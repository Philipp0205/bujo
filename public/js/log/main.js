/*
 * Boots the rapid log: loads the window of days, renders it, and wires the inline editor and the sheets. Needs every other
 * log file and core.js. The state lives here and nowhere else. The Scan tab (and ?scan=1) starts the scan flow from here,
 * the Add tab opens the new-entry sheet from here.
 * The page registers with BujoNav.router, which shows it on a cold load of / and again whenever the Rapid log tab is tapped
 * (the page stays in the document, hidden, while another tab is on screen). The last rows come from AppKit.swr at once.
 * While an entry waits for its push to Nextcloud, the log
 * reads its own API again every so often (never Nextcloud) and stops when nothing is pending. It also asks the
 * what's-new boot to show entries the person has not seen yet.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  var root = document.getElementById('log');
  var state = { status: 'loading', entries: [], today: L.dates.todayIso(), focus: null, version: 0, drawnToday: null };
  var booted = false;
  var POLL_MS = 800;
  var pollTimer = null;

  /** The things a card or the add row can do. A note with a body opens the note sheet, any other entry opens the edit sheet. select is select mode. */
  var actions = {
    open: function (entry) {
      if (L.note.model.isNote(entry)) L.inline.editor.settle(function () { openNote(entry); });
      else L.inline.editor.editEntry(entry);
    },
    add: function () { L.inline.editor.addLine(); },
    select: L.select.mode
  };

  /** The Add tab: a new line in the edit sheet for today. Not while selecting (the select bar owns the page then). */
  function addEntry() {
    if (!L.select.mode.on()) L.inline.editor.addLine();
  }

  /** Starts the scan flow with the phone camera opening at once. Runs inside the tap on the Scan tab, so the chooser may open. */
  function startScan() {
    L.scan.flow.start({ day: state.today, onApplied: applied, autoCapture: true });
  }

  /** Arriving with ?scan=1 (a shared link): drops the query so a refresh does not reopen the camera.
   * Returns true when the link asked for a scan. */
  function scanFromLink() {
    var params = new URLSearchParams(window.location.search);
    if (!params.has('scan')) return false;
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.hash);
    return true;
  }

  function openNote(entry) {
    L.note.sheet.open({ mode: 'saved', values: L.note.model.fromEntry(entry), onSaved: reload });
  }

  /** What the inline editor needs from the page: the day, a redraw, saved entries and the details sheet. */
  var host = {
    today: function () { return state.today; },
    draw: draw,
    upsert: upsert,
    replaceDay: replaceDay,
    entries: function () { return state.entries; },
    dayEntries: function (date) { return L.days.dayEntries(state.entries, date); },
    openSheet: function (entry) { L.sheet.open({ entry: entry, today: state.today, onSaved: reload }); }
  };

  /** Swaps every entry of one day for the server's list of that day (after a delete or a move). */
  function replaceDay(date, entries) {
    state.entries = state.entries.filter(function (entry) { return entry.date !== date; }).concat(entries);
    state.status = 'ready';
    state.version += 1;
    recount();
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
    recount();
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

  /** The top of the page: the select bar while selecting, otherwise the italic title header (with "Not on paper" when entries wait). */
  function top() {
    return L.select.mode.on() ? L.select.mode.bar() : L.view.header(L.paper.count.get(), openPaperList);
  }

  /** Opens the "not on paper" list. Marking an entry as written reads the log again, so its row mark goes. */
  function openPaperList() {
    L.inline.editor.settle(function () {
      L.paper.sheet.open({ today: state.today, onCount: L.paper.count.set, onChanged: function () { load(true, 'plain'); } });
    });
  }

  /** Reads the number of entries not on paper again, after the log changed. */
  function recount() {
    L.paper.count.refresh(state.today);
  }

  /** Draws the whole page from the state, then inks its cards. The page is small, so nothing is patched in place. */
  function draw() {
    state.drawnToday = state.today;
    root.replaceChildren(top(), AppKit.h('div', { class: 'paper-page' }, body()));
    L.ink.decorate.list(root);
  }

  /** Redraws through the editor, which puts the line being typed back with its draft and focus. */
  function render() {
    L.inline.editor.paint();
  }

  /** A tap on the paper itself (not on a row, heading or button) starts a line, like a text document. Not while selecting. */
  function onPaperTap(event) {
    var target = event.target;
    var bare = target === root || target.classList.contains('paper-page') || target.hasAttribute('data-today');
    if (bare && state.status === 'ready' && !L.select.mode.on()) L.inline.editor.addLine();
  }

  /** Reads the window around today, stretched to the day of the last applied scan. */
  function fetchWindow() {
    state.today = L.dates.todayIso();
    var range = L.dates.windowWith(state.today, state.focus);
    return L.api.list(range.from, range.to);
  }

  /** Takes a list that was read while the state was at version `seen`. True when the screen has to change. */
  function accept(entries, seen) {
    if (seen !== state.version) return false;
    var same = state.status === 'ready' && state.drawnToday === state.today && JSON.stringify(entries) === JSON.stringify(state.entries);
    state.entries = entries;
    state.status = 'ready';
    return !same;
  }

  /**
   * Loads the window and draws it. via says where the list comes from: 'plain' is the server alone (after a save, and the pending
   * poll: a read must not join an older one), 'cache' goes through AppKit.swr, and 'first' also paints the last cached rows at
   * once, so a visit starts with rows instead of a loading note. A failed quiet refresh, or a failure behind rows that are
   * already shown, keeps those rows on screen.
   */
  function load(quiet, via) {
    var seen = state.version;
    var take = function (entries) { if (accept(entries, seen)) render(); };
    var failed = function () {
      if (quiet || state.status === 'ready') return;
      state.status = 'error';
      render();
    };
    var done = function () {
      watchPending();
      if (seen !== state.version) load(true, 'plain');
    };
    if (via === 'plain') return BujoNav.data.fresh(BujoNav.data.KEYS.log, fetchWindow).then(take, failed).then(done);
    var stale = function (entries) { if (via === 'first' && state.status !== 'ready') take(entries); };
    return BujoNav.data.load(BujoNav.data.KEYS.log, fetchWindow, { stale: stale, fresh: take, fail: failed }).then(done);
  }

  /** Reads the log again with the loading note. Never used while a line is being typed. */
  function reload() {
    state.status = 'loading';
    render();
    return load(false, 'plain').then(recount);
  }

  /** True while some entry still waits for its push to Nextcloud. */
  function anyPending() {
    return state.status === 'ready' && state.entries.some(function (entry) { return entry.sync === 'pending'; });
  }

  /** Reads the log again without the loading note, so a dot turns from pending to synced or error on its own. */
  function refreshQuietly() {
    pollTimer = null;
    if (!anyPending()) return;
    load(true, 'plain');
  }

  /** While an entry is pending, ask the app's own API again soon. With none pending the timer is left off. */
  function watchPending() {
    if (pollTimer !== null || !anyPending()) return;
    pollTimer = window.setTimeout(refreshQuietly, POLL_MS);
  }

  /** One-time setup of the page: the install banner, the inline editor, the first rows (from the cache when there is one), what's new. */
  function boot(ctx) {
    booted = true;
    AppKit.installPrompt.init({ appName: 'bujo', iconUrl: '/icons/icon-192.png' });
    L.inline.editor.init(host);
    L.select.mode.init({ host: host, root: root });
    root.addEventListener('click', onPaperTap);
    L.paper.count.init(root, openPaperList);
    render();
    load(false, 'first').then(recount);
    // The camera of a scan and the sheet of a new entry are not covered by the what's-new sheet: that waits for the next visit.
    if (ctx.scan || scanFromLink()) startScan();
    else if (ctx.add) addEntry();
    else BujoWhatsNew.boot.showUnseen();
  }

  /** The router shows the log (the first time, or again from another tab): boots once, then reads the rows again quietly. */
  function show(ctx) {
    if (!booted) return boot(ctx);
    if (ctx.scan) startScan();
    else if (ctx.add) addEntry();
    load(true, 'cache').then(recount);
  }

  /** Reads the rows into the cache while another tab is on screen, so the first switch here can paint them at once. */
  function warm() {
    BujoNav.data.warm(BujoNav.data.KEYS.log, fetchWindow);
  }

  BujoNav.router.start('log', { show: show, scan: startScan, add: addEntry, warm: warm });
})();
