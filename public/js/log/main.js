/*
 * Boots the log: loads the days, renders the page of the view on screen, and wires the inline editor and the sheets. Needs every
 * other log file and core.js. The state lives here and nowhere else. The Scan tab (and ?scan=1) starts the scan flow from here,
 * the Add tab opens the new-entry sheet from here. The log is a notebook with three views (Future, Month, Daily, js/log/horizon).
 * Daily is a page per day (js/log/pages), turned by swipe, arrows, the date picker or a ?day= link; state.page is the day on screen,
 * or null to follow today. Month shows one month (state.month, null follows this month) and Future the next six months. Month and
 * Future read one span of days, Daily its window around today, so a switch reads again (state.loadedKey says which read is held).
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
    status: 'loading', entries: [], server: [], serverTraces: [], traces: [], offline: false, today: L.dates.todayIso(), focus: null, version: 0, drawnToday: null,
    page: null, turn: null, arrival: false, view: 'daily', month: null, loadedKey: null
  };
  var booted = false;
  var POLL_MS = 800;
  var pollTimer = null;
  var BARE = ['paper', 'paper-page', 'page-leaf', 'page-body', 'paper-day-group', 'horizon-section'];

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

  /** What the pages draw: the live entries and, after them, the traces that moves left (a day with only a trace is still a page). */
  function drawn() {
    return L.move.traces.withTraces(state.entries, state.traces);
  }

  /** The page on screen: its day and the days that are pages. While loading the day is the one asked for, since there are no entries to check it against. */
  function shownPage() {
    var days = L.pages.model.sequence(drawn(), state.today);
    var ready = state.status === 'ready';
    return { days: days, date: ready ? L.pages.model.settle(days, state.page, state.today) : state.page || state.today };
  }

  /** Shows a day (today is the page that follows today, so it is stored as null). */
  function setPage(date) {
    state.page = date === state.today ? null : date;
  }

  /** The month the Month view shows: the one picked, else this month. */
  function shownMonth() {
    return state.month || L.pages.model.monthOf(state.today);
  }

  /** Where a new line goes: the day of the Daily page, or the month on screen (a month-task or a future item). */
  function slot() {
    if (state.view === 'daily') return { date: shownPage().date, horizon: 'day' };
    return L.horizon.model.slotOf(state.view, shownMonth(), state.today);
  }

  /** The Add tab: a new line in the view on screen. Not while selecting (the select bar owns the page then). */
  function addEntry() {
    if (!L.select.mode.on()) L.inline.editor.addLine();
  }

  /** The Add tab from another tab: the Daily log opens on today, the other views stay as they are. The new line goes there. */
  function addFromTab() {
    if (L.select.mode.on()) return;
    if (state.view === 'daily') state.page = null;
    L.inline.editor.addLine();
  }

  /** The day a scanned page falls back to when it names none: today, or the first of the month on screen when that is another month. */
  function scanDay() {
    if (state.view === 'daily') return state.today;
    var month = shownMonth();
    return month === L.pages.model.monthOf(state.today) ? state.today : month + '-01';
  }

  /** Starts the scan flow with the phone camera opening at once. Runs inside the tap on the Scan tab, so the chooser may open.
   * The open view goes along as a hint for the kind of page. */
  function startScan() {
    L.scan.flow.start({ day: scanDay(), view: state.view, onApplied: applied, autoCapture: true });
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

  /** What the inline editor needs from the page: the slot for a new line, the entries, a redraw, saved entries and the details sheet. */
  var host = {
    today: function () { return state.today; },
    slot: slot,
    draw: draw,
    upsert: upsert,
    replaceGroup: replaceGroup,
    entries: function () { return state.entries; },
    group: function (horizon, date) { return L.days.groupEntries(state.entries, horizon, date); },
    forget: forget,
    openSheet: function (entry) { L.sheet.open({ entry: entry, today: state.today, onSaved: reload }); }
  };

  /** The log the person sees: the server's list with the queued entries and changes laid over it, and the traces that goes with them. */
  function rebuild() {
    var items = L.outbox.queue.items();
    state.entries = L.outbox.model.merge(state.server, items);
    state.traces = L.move.traces.derive(state.serverTraces, state.server, items);
  }

  /** An entry was deleted: the traces it left on other pages went with it on the server, so they leave the page too. */
  function forget(id) {
    state.serverTraces = L.move.traces.forget(state.serverTraces, id);
    rebuild();
  }

  /** Swaps every entry of one group (a day, or the items of one month) for the list of that group (after a delete or a move). */
  function replaceGroup(horizon, date, entries) {
    state.server = state.server.filter(function (entry) { return !(entry.date === date && L.days.horizonOf(entry) === horizon); }).concat(entries);
    rebuild();
    state.status = 'ready';
    state.version += 1;
    recount();
  }

  /** Puts a saved entry in the server list, and settles its traces: a move to another page leaves the one asked for (kind) on the old page. */
  function takeSaved(entry, kind) {
    var at = state.server.findIndex(function (item) { return item.id === entry.id; });
    if (at >= 0) {
      state.serverTraces = L.move.traces.afterMove(state.serverTraces, state.server[at], entry, kind);
      state.server[at] = entry;
    } else {
      state.server.push(entry);
    }
  }

  /** A saved entry on a day beyond the usual window stretches the window to that day, so a later read still holds it (its page stays reachable). */
  function keepInWindow(entry) {
    if (L.days.horizonOf(entry) !== 'day') return;
    if (!L.pages.model.within(L.dates.windowAround(state.today), entry.date)) state.focus = entry.date;
  }

  /** Keeps the entries in step with an entry the editor just saved: replaced in place, or added at the end. An entry that is
   * still queued (a new one, or one with queued changes) is not the server's, so it stays out of the server list: the merge shows it.
   * kind is the trace the save asked for, if any. The version bump makes a read that was already in flight start over, so it cannot hide the saved entry. */
  function upsert(entry, kind) {
    if (kind) keepInWindow(entry);
    if (!entry.queued) takeSaved(entry, kind);
    rebuild();
    state.status = 'ready';
    state.version += 1;
    watchPending();
    recount();
  }

  /** After a scan is applied or a note saved: show where it landed. Month tasks and a calendar open the Month view on their month, a
   * future page the Future view, a day the Daily view even when it is outside the usual window. A month the views do not reach
   * opens the Daily view on its first day instead. */
  function applied(result) {
    if (result.view === 'future') showHorizon('future', null);
    else if (result.view === 'month') showMonthOrDay(result.month);
    else showDay(result.date);
    reload();
  }

  /** Points the log at a day of the Daily view. */
  function showDay(date) {
    state.view = 'daily';
    state.focus = date;
    setPage(date);
  }

  /** Points the log at the Future view, or at the Month view on a month. */
  function showHorizon(view, month) {
    state.view = view;
    state.month = month && month !== L.pages.model.monthOf(state.today) ? month : null;
  }

  /** The Month view on a month the views reach, else the Daily view on its first day. */
  function showMonthOrDay(month) {
    if (L.horizon.model.readMonth(month, state.today)) showHorizon('month', month);
    else showDay(month + '-01');
  }

  /** The body of the page for the current status: the cards of the view on screen, with a quiet hint above them while offline. */
  function body(date) {
    if (state.status !== 'ready') return L.view.stateNote(state.status, reload);
    return [state.offline ? L.view.offlineHint() : null, viewBody(date)];
  }

  /** The cards of the view: a day, a month or the six months. */
  function viewBody(date) {
    var ctx = { entries: drawn(), today: state.today, actions: actions, month: shownMonth() };
    if (state.view === 'month') return L.horizon.screen.monthBody(ctx);
    if (state.view === 'future') return L.horizon.screen.futureBody(ctx);
    return L.view.dayPage(date, ctx.entries, actions, state.today);
  }

  /** The top of the page: the select bar while selecting, otherwise the italic title header (with "Not on paper" when entries wait). */
  function top() {
    if (L.select.mode.on()) return L.select.mode.bar();
    return L.view.header(L.paper.count.get(), openPaperList, L.copy.horizon.titles[state.view]);
  }

  /** True when a page may turn: not while selecting, not while a line is typed, and only once the days are loaded. */
  function canTurn() {
    return state.status === 'ready' && !L.select.mode.on() && !L.inline.editor.line();
  }

  /** True while selecting or typing: the switcher and the arrows are off then. */
  function locked() {
    return L.select.mode.on() || !!L.inline.editor.line();
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

  /** Shows another month of the Month view (this month is stored as null, so the view keeps following today). */
  function turnToMonth(month, direction) {
    if (!canTurn() || month === shownMonth()) return;
    state.month = month === L.pages.model.monthOf(state.today) ? null : month;
    state.turn = direction;
    render();
  }

  /** The arrow, edge tap or swipe: turns to the page or month before or after the one on screen. The ends have none; Future has none. */
  function turnBy(direction) {
    if (state.view === 'future') return;
    if (state.view === 'month') {
      var month = L.horizon.model.shifted(shownMonth(), direction === 'next' ? 1 : -1, state.today);
      if (month) turnToMonth(month, direction);
      return;
    }
    var shown = shownPage();
    var target = L.pages.model.neighbours(shown.days, shown.date)[direction];
    if (target) turnTo(target, direction);
  }

  /** The Today jump: back to the page of today, or to this month. */
  function turnHome() {
    if (state.view !== 'month') { turnTo(state.today); return; }
    var here = L.pages.model.monthOf(state.today);
    turnToMonth(here, here > shownMonth() ? 'next' : 'prev');
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
      anchor: anchor, date: shownPage().date, today: state.today, marks: L.pages.model.marksOf(drawn()),
      loaded: L.dates.windowWith(state.today, state.focus), onPick: turnToPicked
    });
  }

  var nav = { turn: turnBy, pick: openPicker, home: turnHome };

  /** The view switcher row, off while selecting or typing. */
  function switcher() {
    return L.horizon.switcher.build({ view: state.view, locked: locked(), onPick: switchView });
  }

  /** The page of the notebook on screen: a day, a month or the six months, with the leaf that slides in after a turn. */
  function pageNode(turn) {
    if (state.view !== 'daily') return horizonNode(turn);
    var shown = shownPage();
    var ready = state.status === 'ready';
    return L.pages.view.page({
      date: shown.date, ready: ready, isToday: shown.date === state.today, number: ready ? L.pages.model.numberOf(shown.days, shown.date) : 0,
      around: ready ? L.pages.model.neighbours(shown.days, shown.date) : { prev: null, next: null },
      locked: locked(), turn: turn, body: body(shown.date), nav: nav, view: 'daily', switcher: switcher()
    });
  }

  /** The page of the Month or Future view: the same shell as a day, with its own head. */
  function horizonNode(turn) {
    var month = shownMonth();
    var ready = state.status === 'ready';
    var inMonth = state.view === 'month';
    var around = inMonth && ready
      ? { prev: L.horizon.model.shifted(month, -1, state.today), next: L.horizon.model.shifted(month, 1, state.today) }
      : { prev: null, next: null };
    var ctx = { ready: ready, locked: locked(), turn: turn, body: body(null), nav: nav, view: state.view, switcher: switcher(), around: around, number: 0 };
    var head = inMonth
      ? L.horizon.screen.monthHead({ month: month, isThisMonth: month === L.pages.model.monthOf(state.today), locked: ctx.locked, around: around, nav: nav })
      : L.horizon.screen.futureHead();
    return L.pages.view.shell(ctx, inMonth ? month : 'future', head);
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

  /** Puts the address in step with the view on screen. Not while the page of a link is still being found. */
  function syncAddress() {
    if (state.status !== 'ready' || state.arrival) return;
    L.pages.address.sync({ view: state.view, month: shownMonth(), date: shownPage().date, today: state.today });
  }

  /** Draws the whole page from the state, then inks its cards. The page is small, so nothing is patched in place. A redraw keeps the scroll of the sheet, a turn starts at the top. */
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
    return L.api.listWithTraces(range.from, range.to);
  }

  /** Reads the span of Month and Future: the first of this month through the end of the sixth month. */
  function fetchSpan() {
    state.today = L.dates.todayIso();
    var range = L.horizon.model.span(state.today);
    return L.api.listWithTraces(range.from, range.to);
  }

  /** What a view reads: its cache key and its fetcher. Month and Future share one span, so a switch between them needs no read. */
  function sourceOf(view) {
    var keys = BujoNav.data.KEYS;
    return view === 'daily' ? { key: keys.log, fetch: fetchWindow } : { key: keys.logAhead, fetch: fetchSpan };
  }

  /** A page asked for by a link that has no entries is not a page: the log shows today instead. True when that changed the page. */
  function settleArrival() {
    if (!state.arrival) return false;
    state.arrival = false;
    if (!state.page || L.pages.model.sequence(drawn(), state.today).indexOf(state.page) >= 0) return false;
    state.page = null;
    return true;
  }

  /** Takes a list that was read while the state was at version `seen`, from the source `key`. True when the screen has to change. A list that came from the
   * server (final) also ends the arrival on a ?day= page. */
  function accept(list, seen, final, key) {
    if (seen !== state.version) return false;
    var parts = L.move.traces.split(list);
    var items = L.outbox.queue.items();
    var shown = L.outbox.model.merge(parts.entries, items);
    var traces = L.move.traces.derive(parts.traces, parts.entries, items);
    var same = state.status === 'ready' && state.drawnToday === state.today && state.loadedKey === key
      && JSON.stringify(shown) === JSON.stringify(state.entries) && JSON.stringify(traces) === JSON.stringify(state.traces);
    state.server = parts.entries;
    state.serverTraces = parts.traces;
    state.entries = shown;
    state.traces = traces;
    state.status = 'ready';
    state.loadedKey = key;
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

  /** Loads what the view on screen reads and draws it. via says where the list comes from: 'plain' is the server alone (after a save, and the pending
   * poll: a read must not join an older one), 'cache' goes through AppKit.swr, and 'first' also paints the last cached rows at
   * once, so a visit starts with rows instead of a loading note. A failed quiet refresh, or a failure behind rows that are
   * already shown, keeps those rows on screen. A read that fails for lack of a connection says "offline" instead of failing.
   * The source is taken when the read starts; a view switch in between bumps the version, so that read is dropped and the next one is the new view's.
   */
  function load(quiet, via) {
    var seen = state.version;
    var source = sourceOf(state.view);
    var take = function (entries) { if (accept(entries, seen, false, source.key)) render(); };
    var fresh = function (entries) {
      var was = state.offline;
      state.offline = false;
      if (accept(entries, seen, true, source.key) || was) render();
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
    if (via === 'plain') return BujoNav.data.fresh(source.key, source.fetch).then(fresh, failed).then(done);
    var stale = function (entries) { if (via === 'first' && state.status !== 'ready' && !state.arrival) take(entries); };
    return BujoNav.data.load(source.key, source.fetch, { stale: stale, fresh: fresh, fail: failed }).then(done);
  }

  /** The switcher: shows another view. The entries on screen belong to the view's own read, so a view whose read is not the one held starts loading. */
  function switchView(view) {
    if (view === state.view || locked()) return;
    L.inline.editor.settle(function () {
      state.view = view;
      state.turn = null;
      state.version += 1;
      if (state.loadedKey !== sourceOf(view).key) state.status = 'loading';
      render();
      if (state.status === 'loading') load(false, 'first').then(recount);
    });
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

  /** A link with ?view=month (and ?month=) or ?view=future: that view opens first. True when the link asked for one. */
  function arriveAtView() {
    var view = L.pages.address.readView();
    if (view !== 'month' && view !== 'future') return false;
    state.view = view;
    var month = L.horizon.model.readMonth(L.pages.address.readMonth(), state.today);
    state.month = month && month !== L.pages.model.monthOf(state.today) ? month : null;
    return true;
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
    L.pages.scroll.init(root);
    root.addEventListener('click', onPaperTap);
    L.paper.count.init(root, openPaperList);
    var linked = arriveAtView() || arriveAtDay();
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

  /** The queue sent an entry: the page takes the saved entry in place of the queued one, with the trace the sent change asked for. */
  function onSent(entry, item) {
    if (!booted) return;
    upsert(entry, item && item.kind === 'update' ? item.body.trace : null);
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
