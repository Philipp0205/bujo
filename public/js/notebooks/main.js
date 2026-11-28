/*
 * The notebooks screen: the list of the physical notebooks (the active one marked, a button to start a new one) and the detail of one
 * (its daily, monthly and future logs, its collections and free notes, and an Index row that opens the index subpage: the grid of page
 * numbers and the way to the page list). It keeps its own state,
 * reads through the tab cache (the list) and a cache per notebook (the detail), and hands what only the Notes host can do to handlers:
 * onOpenCollection(collection), onOpenPage(item), onOpenIndex(pages), leaveSub() and suspended() (true while a collection page or the page list
 * is drawn into the same root; leaveSub closes it). An open notebook is a Back layer, and its index subpage is a second one on top (nav/overlays.js). Needs ak-dom.js, notebooks/*, notes/model.js and notes/view.js (cards, collection rows), index/*,
 * collections/chooser.js, log/note/*, log/ink/decorate.js, log/scan/marker.js, log/api.js, log/outbox/model.js and the nav files (data cache).
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var N = window.BujoNotebooks = window.BujoNotebooks || {};
  var L = window.BujoLog;
  var B = window.BujoNotes;

  var state = { mode: 'list', status: 'loading', notebooks: [], offline: false, id: null, detail: null, detailStatus: 'loading', sub: null };
  var root = null;
  var handlers = null;
  var booted = false;
  var returnTo = null;
  var LAYER = 'notebook';
  var SUB_LAYER = 'notebook-index';

  /** What the list holds and the cache keeps: the notebooks, the active one first. */
  function fetchList() {
    return L.api.listNotebooks().then(function (notebooks) { return { notebooks: notebooks }; });
  }

  /** The cache key of one notebook's detail. */
  function detailKey(id) {
    return 'bujo-notebook-' + id;
  }

  /** The note grid and collection rows of a notebook, under one heading; a quiet line when it has neither. */
  function notesSection(detail) {
    var copy = N.copy;
    var groups = B.model.groups(B.model.cards(detail.notes, L.dates.todayIso()));
    var empty = !detail.collections.length && !groups.length;
    return h('section', { class: 'notes-section', 'data-testid': 'section-collections' },
      N.view.heading(copy.sections.collections),
      empty ? h('p', { class: 'notebook-none' }, copy.collectionsEmpty) : null,
      B.view.collectionList(detail.collections, handlers.onOpenCollection),
      B.view.noteSection(groups, openNote, detail.collections.length > 0));
  }

  /** The detail of a ready notebook: its summary, the start buttons (the active notebook only), the Index row, then the sections. */
  function detailBody() {
    var detail = state.detail;
    var status = N.model.pageStatus(detail.pages, detail.notebook.pageCount);
    return [
      state.offline ? B.view.offlineHint() : null,
      N.view.summary(detail.notebook, status),
      detail.notebook.active ? B.view.actions(newNote, newCollection) : null,
      N.view.indexRow(openIndexSub),
      N.view.logSections(detail.pages, handlers.onOpenPage),
      notesSection(detail)
    ];
  }

  /** The index subpage of a ready notebook: the way to the page list, then the legend and the page number grid. */
  function indexBody() {
    var detail = state.detail;
    var status = N.model.pageStatus(detail.pages, detail.notebook.pageCount);
    var pageList = B.view.indexEntry(detail.pages.length, function () { handlers.onOpenIndex(detail); });
    return [state.offline ? B.view.offlineHint() : null, N.view.indexPage(status, handlers.onOpenPage, pageList)];
  }

  /** The notebook detail or its index subpage: the loading or error note, or the body. */
  function detailScreen() {
    var head = state.detail ? state.detail.notebook : { name: '' };
    var ready = state.detailStatus === 'ready';
    var body = !ready ? B.view.stateNote(state.detailStatus, function () { openDetail(state.id); }) : state.sub === 'index' ? indexBody() : detailBody();
    var header = state.sub === 'index' ? N.view.indexHeader(closeIndexSub) : N.view.detailHeader(head, back);
    return [header, h('div', { class: 'paper-page' }, body)];
  }

  /** The list of notebooks: the start button and one row each, or the loading and error notes. */
  function listScreen() {
    var body = state.status !== 'ready' ? B.view.stateNote(state.status, reloadList)
      : [state.offline ? B.view.offlineHint() : null, N.view.startAction(startNew), N.view.notebookList(state.notebooks, openDetail)];
    return [N.view.listHeader(), h('div', { class: 'paper-page' }, body)];
  }

  /** Draws the whole screen from the state, then inks its cards. Not while a collection page or the page list is open in the same root. */
  function draw() {
    if (handlers.suspended()) return;
    var parts = state.mode === 'list' ? listScreen() : detailScreen();
    root.replaceChildren.apply(root, parts);
    L.ink.decorate.notes(root);
  }

  /** Opens the sheet of one note; the detail is read again after a save or a delete. */
  function openNote(id) {
    var entry = state.detail.notes.filter(function (item) { return item.id === id; })[0];
    if (entry) L.note.sheet.open({ mode: 'saved', values: L.note.model.fromEntry(entry), onSaved: refreshDetail });
  }

  /** Opens the sheet for a note written by hand: no scan, several lines, on today. */
  function newNote() {
    L.note.sheet.open({ mode: 'new', values: L.note.model.blank(L.dates.todayIso()), onSaved: refreshDetail });
  }

  /** Asks for a name, then opens the new (empty) collection page. */
  function newCollection() {
    L.collections.chooser.askName(handlers.onOpenCollection);
  }

  /** Asks for a name and a page count, then starts the notebook and shows the list with it on top. */
  function startNew() {
    N.sheet.open(N.model.suggestedName(state.notebooks), reloadList);
  }

  /** Takes the list. Old cached values (from before notebooks) are not a list and are left out. The page is drawn again only when it changed. */
  function acceptList(value) {
    if (!value || !Array.isArray(value.notebooks)) return;
    var same = state.status === 'ready' && !state.offline && JSON.stringify(value.notebooks) === JSON.stringify(state.notebooks);
    state.notebooks = value.notebooks;
    state.status = 'ready';
    state.offline = false;
    if (!same && state.mode === 'list') draw();
  }

  /** A failed read keeps the list that is on screen. With no connection it says so quietly; else the error note shows when there is no list. */
  function failedList(error) {
    var offline = L.outbox.model.isNetworkMiss(error, navigator.onLine);
    if (offline) state.offline = true;
    if (state.status === 'ready' && !offline) return;
    state.status = state.status === 'ready' ? 'ready' : offline ? 'offline' : 'error';
    if (state.mode === 'list') draw();
  }

  /** Reads the list through the cache. paintCache draws the last list at once when the screen has none yet. */
  function loadList(paintCache) {
    var stale = paintCache ? function (value) { if (state.status !== 'ready') acceptList(value); } : null;
    return BujoNav.data.load(BujoNav.data.KEYS.notes, fetchList, { stale: stale, fresh: acceptList, fail: failedList });
  }

  /** Reads the list again with the loading note (after starting a notebook): the server alone, so the list holds that change. */
  function reloadList() {
    release();
    state.mode = 'list';
    state.status = 'loading';
    draw();
    return BujoNav.data.fresh(BujoNav.data.KEYS.notes, fetchList).then(acceptList, failedList);
  }

  /** Takes the detail of the open notebook; an answer for a notebook that is not open any more is dropped. */
  function acceptDetail(id, value) {
    if (state.mode !== 'detail' || state.id !== id) return;
    var same = state.detailStatus === 'ready' && !state.offline && JSON.stringify(value) === JSON.stringify(state.detail);
    state.detail = value;
    state.detailStatus = 'ready';
    state.offline = false;
    if (!same) draw();
    revealIndex();
  }

  /** After a way back from an index page: scrolls the index grid to the top of the screen, once the drawn index subpage has it. */
  function revealIndex() {
    var grid = state.toIndex && root.querySelector('.notebook-grid');
    if (!grid) return;
    state.toIndex = false;
    // The browser restores its own scroll after a Back; scroll once that has run.
    window.setTimeout(function () { grid.scrollIntoView({ block: 'start' }); }, 50);
  }

  /** A failed detail read keeps the detail on screen; with none it shows the offline or error note. */
  function failedDetail(id, error) {
    if (state.mode !== 'detail' || state.id !== id) return;
    var offline = L.outbox.model.isNetworkMiss(error, navigator.onLine);
    if (offline && state.detailStatus === 'ready') state.offline = true;
    else if (state.detailStatus !== 'ready') state.detailStatus = offline ? 'offline' : 'error';
    draw();
  }

  /** Opens one notebook: the cached detail at once when there is one, then the server's. from ({ index }) says it is a way back from a log page, to the index subpage or the notebook. */
  function openDetail(notebook, from) {
    var id = typeof notebook === 'string' ? notebook : notebook.id;
    state.toIndex = !!from && from.index === true;
    state.sub = state.toIndex ? 'index' : null;
    state.mode = 'detail';
    state.id = id;
    state.detail = null;
    state.detailStatus = 'loading';
    // After a Back the kit's own popstate listener is still to run; a layer opened now would be taken for that Back and closed.
    if (from) window.setTimeout(holdAll, 0); else hold();
    draw();
    window.scrollTo(0, 0);
    var stale = function (value) { if (state.detailStatus !== 'ready') acceptDetail(id, value); };
    var fetch = function () { return L.api.getNotebook(id); };
    return BujoNav.data.load(detailKey(id), fetch, { stale: stale, fresh: function (value) { acceptDetail(id, value); }, fail: function (error) { failedDetail(id, error); } });
  }

  /** Opens the index subpage over the notebook: its own Back layer, so Back shows the notebook again. */
  function openIndexSub() {
    state.sub = 'index';
    holdSub();
    draw();
    window.scrollTo(0, 0);
  }

  /** Leaves the index subpage for the notebook (the on-screen link; the kit steps history back for the released layer). */
  function closeIndexSub() {
    BujoNav.overlays.release(SUB_LAYER);
    showNotebook();
  }

  /** Draws the notebook itself again, from the top, after the index subpage went. */
  function showNotebook() {
    state.sub = null;
    draw();
    window.scrollTo(0, 0);
  }

  /** Reads the open notebook again with the loading note (after a note was saved or a collection page was left): the server alone. */
  function refreshDetail() {
    if (state.mode !== 'detail') return Promise.resolve();
    var id = state.id;
    state.detailStatus = 'loading';
    draw();
    return BujoNav.data.fresh(detailKey(id), function () { return L.api.getNotebook(id); }).then(function (value) { acceptDetail(id, value); }, function (error) { failedDetail(id, error); });
  }

  /** Back from a notebook to the list. */
  function back() {
    release();
    state.mode = 'list';
    state.id = null;
    state.detail = null;
    draw();
    window.scrollTo(0, 0);
    loadList(false);
  }

  /** The phone's Back on a notebook: a collection page or page list on top closes first (the detail stays), else the list shows. */
  function closeLayer() {
    if (!handlers.suspended()) { back(); return; }
    handlers.leaveSub();
    BujoNav.overlays.restore(LAYER);
  }

  /** The phone's Back on the index subpage: a page list on top closes first (the subpage stays), else the notebook shows. */
  function closeSubLayer() {
    if (handlers.suspended()) {
      handlers.leaveSub();
      BujoNav.overlays.restore(SUB_LAYER);
      return;
    }
    BujoNav.overlays.release(SUB_LAYER);
    showNotebook();
  }

  /** The notebook detail is on screen: one history entry, so Back shows the list and stays on Notes. */
  function hold() {
    BujoNav.overlays.open(LAYER, closeLayer);
  }

  /** The index subpage is on screen: one more history entry on top of the notebook's. */
  function holdSub() {
    BujoNav.overlays.open(SUB_LAYER, closeSubLayer);
  }

  /** After a way back from the log: the notebook's entry, and the subpage's when the person came from it. */
  function holdAll() {
    hold();
    if (state.sub === 'index') holdSub();
  }

  /** The notebook detail and its subpage are left (any way): their history entries go. */
  function release() {
    BujoNav.overlays.release(SUB_LAYER);
    BujoNav.overlays.release(LAYER);
    state.sub = null;
  }

  /** An index page is about to open elsewhere (the log): the next show that comes from Back opens this notebook again (at the index subpage when it came from there), not the list. */
  function keepForBack() {
    if (state.mode === 'detail') returnTo = { id: state.id, index: state.sub === 'index' };
  }

  /** The router shows Notes: the notebook an index page was opened from when ctx.back says so, else the list. */
  function show(ctx) {
    var kept = returnTo;
    returnTo = null;
    if (kept && ctx && ctx.back) { booted = true; return openDetail(kept.id, kept); }
    return showList();
  }

  /** The notebooks list, the cached list at once on the first show, then read quietly. */
  function showList() {
    release();
    state.mode = 'list';
    state.id = null;
    state.detail = null;
    if (booted) {
      draw();
      return loadList(false);
    }
    booted = true;
    var reading = loadList(true);
    if (!root.firstChild) draw();
    return reading;
  }

  /** Reads the list into the cache while another tab is on screen, so the first switch here can paint it at once. */
  function warm() {
    return BujoNav.data.warm(BujoNav.data.KEYS.notes, fetchList);
  }

  /** The connection came back: read the open screen again quietly. */
  function onOnline() {
    if (!booted) return;
    if (state.mode === 'list') loadList(false);
    else BujoNav.data.fresh(detailKey(state.id), function () { return L.api.getNotebook(state.id); }).then(function (value) { acceptDetail(state.id, value); }, function () { /* stays as it is */ });
  }

  /** Wires the screen to its root and the host's handlers. */
  function init(into, given) {
    root = into;
    handlers = given;
    window.addEventListener('online', onOnline);
  }

  N.screen = { init: init, show: show, warm: warm, draw: draw, refreshDetail: refreshDetail, keepForBack: keepForBack, leave: release };
})();
