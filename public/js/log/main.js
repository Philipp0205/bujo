/*
 * Boots the daily log: loads the window of days, renders the page of one day, and wires the inline editor and the sheets. Needs every
 * other log file and core.js. The state lives here and nowhere else. The Scan tab (and ?scan=1) starts the scan flow from here,
 * the Add tab opens the new-entry sheet from here. The log is a notebook: one day per page (js/log/pages), turned by swipe, arrows,
 * the date picker or a ?day= link. state.page is the day on screen, or null to follow today.
 * The page registers with BujoNav.router, which shows it on a cold load of / and again whenever the Daily log tab is tapped
 * (the page stays in the document, hidden, while another tab is on screen). The last rows come from AppKit.swr at once.
 * While an entry waits for its push to Nextcloud, the log
 * reads its own API again every so often (never Nextcloud) and stops when nothing is pending. It also asks the
 * what's-new boot to show entries the person has not seen yet.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  var root = document.getElementById('log');
  var state = {
    status: 'loading', entries: [], server: [], offline: false, today: L.dates.todayIso(), focus: null, version: 0, drawnToday: null,
    page: null, turn: null, arrival: false
  };
  var booted = false;
  var POLL_MS = 800;
  var pollTimer = null;
  var BARE = ['paper', 'paper-page', 'page-leaf', 'page-body', 'paper-day-group'];

  /** The things a card or the add row can do. A note with a body opens the note sheet, any other entry opens the edit sheet. select is select mode. */
  var actions = {
    open: function (entry) {
      if (L.note.model.isNote(entry)) L.inline.editor.settle(function () { openNote(entry); });
      else L.inline.editor.editEntry(entry);
    },
    add: function () { L.inline.editor.addLine(); },
    toggleDone: function (entry) { L.done.toggle.toggle(entry.id); },
    select: L.select.mode
  };

  /** The page on screen: its day and the days that are pages. While loading the day is the one asked for, since there are no entries to check it against. */
  function shownPage() {
    var days = L.pages.model.sequence(state.entries, state.today);
    var ready = state.status === 'ready';
    return { days: days, date: ready ? L.pages.model.settle(days, state.page, state.today) : state.page || state.today };
  }

  /** Shows a day (today is the page that follows today, so it is stored as null). */
  function setPage(date) {
    state.page = date === state.today ? null : date;
  }

  /** The Add tab: a new line on the page on screen. Not while selecting (the select bar owns the page then). */
  function addEntry() {
    if (!L.select.mode.on()) L.inline.editor.addLine();
  }

  /** The Add tab from another tab: the log opens on today, and the new line goes there. */
  function addFromTab() {
    if (L.select.mode.on()) return;
    state.page = null;
    L.inline.editor.addLine();
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

  /** What the inline editor needs from the page: the days, a redraw, saved entries and the details sheet. */
  var host = {
    today: function () { return state.today; },
    pageDate: function () { return shownPage().date; },
    draw: draw,
    upsert: upsert,
    replaceDay: replaceDay,
    entries: function () { return state.entries; },
    dayEntries: function (date) { return L.days.dayEntries(state.entries, date); },
    openSheet: function (entry) { L.sheet.open({ entry: entry, today: state.today, onSaved: reload }); }
  };

  /** The log the person sees: the server's list with the queued entries and changes laid over it. */
  function rebuild() {
    state.entries = L.outbox.model.merge(state.server, L.outbox.queue.items());
  }

  /** Swaps every entry of one day for the list of that day (after a delete or a move). */
  function replaceDay(date, entries) {
    state.server = state.server.filter(function (entry) { return entry.date !== date; }).concat(entries);
    rebuild();
    state.status = 'ready';
    state.version += 1;
    recount();
  }

  /** Keeps the entries in step with an entry the editor just saved: replaced in place, or added at the end. An entry that is
   * still queued (a new one, or one with queued changes) is not the server's, so it stays out of the server list: the merge shows it.
   * The version bump makes a read that was already in flight start over, so it cannot hide the saved entry. */
  function upsert(entry) {
    if (!entry.queued) {
      var at = state.server.findIndex(function (item) { return item.id === entry.id; });
      if (at >= 0) state.server[at] = entry;
      else state.server.push(entry);
    }
    rebuild();
    state.status = 'ready';
    state.version += 1;
    watchPending();
    recount();
  }

  /** After a scan is applied or a note saved: show the day it landed on, even when it is outside the usual window. */
  function applied(result) {
    state.focus = result.date;
    setPage(result.date);
    reload();
  }

  /** The body of the page for the current status: the cards of the day, with a quiet hint above them while offline. */
  function body(date) {
    if (state.status !== 'ready') return L.view.stateNote(state.status, reload);
    return [state.offline ? L.view.offlineHint() : null, L.view.dayPage(date, state.entries, actions, state.today)];
  }

  /** The top of the page: the select bar while selecting, otherwise the italic title header (with "Not on paper" when entries wait). */
  function top() {
    return L.select.mode.on() ? L.select.mode.bar() : L.view.header(L.paper.count.get(), openPaperList);
  }

  /** True when a page may turn: not while selecting, not while a line is typed, and only once the days are loaded. */
  function canTurn() {
    return state.status === 'ready' && !L.select.mode.on() && !L.inline.editor.line();
  }

  /** Shows another day of the notebook. direction ('next' or 'prev') only picks the way the leaf slides in. Not while selecting or typing. */
  function turnTo(date, direction) {
    if (!canTurn()) return;
    var shown = shownPage().date;
    if (date === shown) return;
    state.turn = direction || (date > shown ? 'next' : 'prev');
    setPage(date);
    render();
  }

  /** The arrow, edge tap or swipe: turns to the page before or after the one on screen. The ends have none. */
  function turnBy(direction) {
    var shown = shownPage();
    var target = L.pages.model.neighbours(shown.days, shown.date)[direction];
    if (target) turnTo(target, direction);
  }

  /** The Today jump: back to the page of today. */
  function turnHome() {
    turnTo(state.today);
  }

  /** A day picked in the calendar: a page of the loaded days turns at once, a day beyond them is read first (the window stretches to it). */
  function turnToPicked(date) {
    if (L.pages.model.within(L.dates.windowWith(state.today, state.focus), date)) { turnTo(date); return; }
    if (!canTurn()) return;
    state.turn = date > shownPage().date ? 'next' : 'prev';
    state.focus = date;
    setPage(date);
    reload();
  }

  /** Opens the day picker under the date row. */
  function openPicker() {
    var anchor = root.querySelector('[data-testid="page-date"]');
    if (!anchor || !canTurn()) return;
    L.pages.picker.open({
      anchor: anchor, date: shownPage().date, today: state.today, marks: L.pages.model.marksOf(state.entries),
      loaded: L.dates.windowWith(state.today, state.focus), onPick: turnToPicked
    });
  }

  var nav = { turn: turnBy, pick: openPicker, home: turnHome };

  /** The page of the notebook on screen, with the leaf that slides in after a turn. */
  function pageNode(turn) {
    var shown = shownPage();
    var ready = state.status === 'ready';
    return L.pages.view.page({
      date: shown.date, ready: ready, isToday: shown.date === state.today, number: ready ? L.pages.model.numberOf(shown.days, shown.date) : 0,
      around: ready ? L.pages.model.neighbours(shown.days, shown.date) : { prev: null, next: null },
      locked: L.select.mode.on() || !!L.inline.editor.line(), turn: turn, body: body(shown.date), nav: nav
    });
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

  /** Puts ?day= of the address in step with the page on screen. Not while the page of a link is still being found. */
  function syncAddress() {
    if (state.status === 'ready' && !state.arrival) L.pages.address.sync(shownPage().date, state.today);
  }

  /** Draws the whole page from the state, then inks its cards. The page is small, so nothing is patched in place. A redraw keeps the scroll of a long page, a turn starts at the top. */
  function draw() {
    var seen = L.pages.scroll.capture(root);
    var turn = state.turn;
    state.turn = null;
    state.drawnToday = state.today;
    root.replaceChildren(top(), pageNode(turn));
    L.pages.scroll.restore(root, seen, !!turn);
    L.ink.decorate.list(root);
    syncAddress();
  }

  /** Redraws through the editor, which puts the line being typed back with its draft and focus. */
  function render() {
    L.inline.editor.paint();
  }

  /** A tap on the paper itself (not on a row, heading, arrow or edge strip) starts a line, like a text document. Not while selecting. */
  function onPaperTap(event) {
    var target = event.target;
    var bare = target === root || BARE.some(function (name) { return target.classList.contains(name); });
    if (bare && state.status === 'ready' && !L.select.mode.on()) L.inline.editor.addLine();
  }

  /** Reads the window around today, stretched to the day of the last applied scan or picked day. */
  function fetchWindow() {
    state.today = L.dates.todayIso();
    var range = L.dates.windowWith(state.today, state.focus);
    return L.api.list(range.from, range.to);
  }

  /** A page asked for by a link that has no entries is not a page: the log shows today instead. True when that changed the page. */
  function settleArrival() {
    if (!state.arrival) return false;
    state.arrival = false;
    if (!state.page || L.pages.model.sequence(state.entries, state.today).indexOf(state.page) >= 0) return false;
    state.page = null;
    return true;
  }

  /** Takes a list that was read while the state was at version `seen`. True when the screen has to change. A list that came from the
   * server (final) also ends the arrival on a ?day= page. */
  function accept(entries, seen, final) {
    if (seen !== state.version) return false;
    var shown = L.outbox.model.merge(entries, L.outbox.queue.items());
    var same = state.status === 'ready' && state.drawnToday === state.today && JSON.stringify(shown) === JSON.stringify(state.entries);
    state.server = entries;
    state.entries = shown;
    state.status = 'ready';
    var moved = final && settleArrival();
    return !same || moved;
  }

  /** A read that failed because the device is offline: the rows stay (or the queued entries stand alone), with the offline hint. */
  function showOffline() {
    state.offline = true;
    if (state.status !== 'ready') { state.status = 'ready'; rebuild(); }
    settleArrival();
    render();
  }

  /** Loads the window and draws it. via says where the list comes from: 'plain' is the server alone (after a save, and the pending
   * poll: a read must not join an older one), 'cache' goes through AppKit.swr, and 'first' also paints the last cached rows at
   * once, so a visit starts with rows instead of a loading note. A failed quiet refresh, or a failure behind rows that are
   * already shown, keeps those rows on screen. A read that fails for lack of a connection says "offline" instead of failing.
   */
  function load(quiet, via) {
    var seen = state.version;
    var take = function (entries) { if (accept(entries, seen, false)) render(); };
    var fresh = function (entries) {
      var was = state.offline;
      state.offline = false;
      if (accept(entries, seen, true) || was) render();
    };
    var failed = function (error) {
      if (L.outbox.model.isNetworkMiss(error, navigator.onLine)) { showOffline(); return; }
      if (quiet || state.status === 'ready') return;
      state.status = 'error';
      state.arrival = false;
      render();
    };
    var done = function () {
      watchPending();
      if (seen !== state.version) load(true, 'plain');
    };
    if (via === 'plain') return BujoNav.data.fresh(BujoNav.data.KEYS.log, fetchWindow).then(fresh, failed).then(done);
    var stale = function (entries) { if (via === 'first' && state.status !== 'ready' && !state.arrival) take(entries); };
    return BujoNav.data.load(BujoNav.data.KEYS.log, fetchWindow, { stale: stale, fresh: fresh, fail: failed }).then(done);
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

  /** A link with ?day= (a valid day the log can load): the page opens on that day, and the first read reaches it. Anything else is today. */
  function arriveAtDay() {
    var day = L.pages.model.readDay(L.pages.address.read(), state.today);
    if (!day) return false;
    state.page = day === state.today ? null : day;
    state.arrival = state.page !== null;
    if (state.arrival && !L.pages.model.within(L.dates.windowAround(state.today), day)) state.focus = day;
    return state.arrival;
  }

  /** One-time setup of the page: the install banner, the inline editor, the first rows (from the cache when there is one), what's new. */
  function boot(ctx) {
    booted = true;
    AppKit.installPrompt.init({ appName: 'bujo', iconUrl: '/icons/icon-192.png' });
    L.inline.editor.init(host);
    L.select.mode.init({ host: host, root: root });
    L.done.toggle.init({
      root: root,
      select: L.select.mode,
      host: { entries: host.entries, today: host.today, upsert: upsert, paint: render }
    });
    L.pages.turn.init({ root: root, active: canTurn, onTurn: turnBy });
    root.addEventListener('click', onPaperTap);
    L.paper.count.init(root, openPaperList);
    var linked = arriveAtDay();
    render();
    L.outbox.queue.load().then(function () { return load(false, 'first'); }).then(recount);
    // The camera of a scan and the sheet of a new entry are not covered by the what's-new sheet: that waits for the next visit.
    if (ctx.scan || scanFromLink()) startScan();
    else if (ctx.add) addFromTab();
    else if (!linked) BujoWhatsNew.boot.showUnseen();
  }

  /** The router shows the log (the first time, or again from another tab): boots once, then reads the rows again quietly. */
  function show(ctx) {
    if (!booted) return boot(ctx);
    L.outbox.replay.flush();
    syncAddress();
    if (ctx.scan) startScan();
    else if (ctx.add) addFromTab();
    load(true, 'cache').then(recount);
  }

  /** Reads the rows into the cache while another tab is on screen, so the first switch here can paint them at once. */
  function warm() {
    BujoNav.data.warm(BujoNav.data.KEYS.log, fetchWindow);
  }

  /** The queue sent an entry: the page takes the saved entry in place of the queued one. */
  function onSent(entry) {
    if (!booted) return;
    upsert(entry);
    render();
  }

  /** The server refused a queued item for good: it is gone from the queue, so the page shows the log without it and says so. */
  function onDropped(item) {
    if (booted) { rebuild(); render(); }
    L.toast.show(item.kind === 'create' ? L.copy.offline.dropped(item.body.title) : L.copy.offline.droppedChange, 'fail');
  }

  /** A flush that sent something: read the log again quietly, so every sync dot and the count are the server's own. */
  function onFlushed() {
    if (booted) load(true, 'plain').then(recount);
  }

  /** The device lost its connection: say so above the days (the rows stay). */
  function onOffline() {
    state.offline = true;
    if (booted && state.status === 'ready') render();
  }

  /** The device is back: read the log again quietly, which also takes the offline hint away. The queue sends itself. */
  function onOnline() {
    if (booted) load(true, 'plain').then(recount);
  }

  /** Starts the outbox at script load, so entries queued earlier are sent even while another tab is on screen. */
  function startOutbox() {
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    state.offline = navigator.onLine === false;
    L.outbox.replay.init({ sent: onSent, dropped: onDropped, finished: onFlushed });
  }

  startOutbox();
  BujoNav.router.start('log', { show: show, scan: startScan, add: addEntry, warm: warm });
})();
