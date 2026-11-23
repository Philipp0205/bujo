/*
 * The Notes screen: the index of free notes and collections. It loads every free note and every collection, draws the collection rows
 * and the note grid, starts a new note or a new collection, and opens the note sheet or a collection page on a tap. The state lives here
 * and nowhere else. The page registers with BujoNav.router, which shows it on a cold load of /notes and again whenever the Notes tab is
 * tapped (the page stays in the document, hidden, while another tab is on screen); that also leaves an open collection page for the index.
 * The last list comes from AppKit.swr at once, so a revisit never shows the loading note. Needs the notes files, the collections files,
 * the log api, ink and note sheet files, the log row files (for a collection page) and the nav files.
 */
(function () {
  'use strict';

  var L = window.BujoLog;
  var B = window.BujoNotes;
  var root = document.getElementById('notes');
  var state = { status: 'loading', entries: [], collections: [], offline: false };
  var booted = false;

  /** Reads the notes and the collections together: the one value the index and its cache hold. */
  function fetchIndex() {
    return Promise.all([L.api.listNotes(), L.api.listCollections()]).then(function (parts) {
      return { entries: parts[0], collections: parts[1] };
    });
  }

  /** The two lists of a cached or fresh value. A list cached before collections existed is just the notes. */
  function parts(value) {
    return Array.isArray(value) ? { entries: value, collections: [] } : value;
  }

  /** The collection rows and the note grid (with a heading over it when collections are listed above). */
  function lists() {
    var groups = B.model.groups(B.model.cards(state.entries, L.dates.todayIso()));
    return [B.view.collectionList(state.collections, openCollection), B.view.noteSection(groups, open, state.collections.length > 0)];
  }

  /** The start buttons, the lists, or an empty note, or the loading and error notes, for the current status. A hint sits above while offline. */
  function body() {
    if (state.status !== 'ready') return B.view.stateNote(state.status, reload);
    var empty = !state.entries.length && !state.collections.length;
    return [state.offline ? B.view.offlineHint() : null, B.view.actions(newNote, newCollection), empty ? B.view.stateNote('empty') : lists()];
  }

  /** Draws the whole page from the state, then inks its cards. The page is small, so nothing is patched in place. Not while a collection page is open. */
  function draw() {
    if (L.collections.page.isOpen()) return;
    root.replaceChildren(B.view.header(), AppKit.h('div', { class: 'paper-page' }, body()));
    L.ink.decorate.notes(root);
  }

  /** Opens the sheet of one note. After a save or a delete the list is read again. */
  function open(id) {
    var entry = state.entries.find(function (item) { return item.id === id; });
    if (entry) L.note.sheet.open({ mode: 'saved', values: L.note.model.fromEntry(entry), onSaved: reload });
  }

  /** Opens the sheet for a note written by hand: no scan, several lines, on today. */
  function newNote() {
    L.note.sheet.open({ mode: 'new', values: L.note.model.blank(L.dates.todayIso()), onSaved: reload });
  }

  /** Asks for a name, then opens the new (empty) collection page. */
  function newCollection() {
    L.collections.chooser.askName(openCollection);
  }

  /** Opens the page of a collection in place of the index. The way back reads the index again, so counts are current. */
  function openCollection(collection) {
    L.collections.page.open(root, collection, leaveCollection);
  }

  /** Back from a collection page to the index. */
  function leaveCollection() {
    L.collections.page.close();
    reload();
  }

  /** Takes a list. The page is only drawn again when it differs from what is on screen (or the offline hint has to go). */
  function accept(value) {
    var next = parts(value);
    var same = state.status === 'ready' && !state.offline && JSON.stringify(next) === JSON.stringify({ entries: state.entries, collections: state.collections });
    state.entries = next.entries;
    state.collections = next.collections;
    state.status = 'ready';
    state.offline = false;
    if (!same) draw();
  }

  /** A failed read keeps the page that is on screen. With no connection it says so quietly instead of failing; else the error note shows when there is no page. */
  function failed(error) {
    var offline = L.outbox.model.isNetworkMiss(error, navigator.onLine);
    if (offline) state.offline = true;
    if (state.status === 'ready' && !offline) return;
    state.status = state.status === 'ready' ? 'ready' : offline ? 'offline' : 'error';
    draw();
  }

  /** The connection came back: read the notes again quietly. */
  function onOnline() {
    if (booted) load(false);
  }

  /** Reads the index through the cache. paintCache draws the last list at once when the screen has no list yet. */
  function load(paintCache) {
    var stale = paintCache ? function (value) { if (state.status !== 'ready') accept(value); } : null;
    return BujoNav.data.load(BujoNav.data.KEYS.notes, fetchIndex, { stale: stale, fresh: accept, fail: failed });
  }

  /** Reads the index again with the loading note (after a save or a delete): the server alone, so the list holds that change. */
  function reload() {
    state.status = 'loading';
    draw();
    return BujoNav.data.fresh(BujoNav.data.KEYS.notes, fetchIndex).then(accept, failed);
  }

  /** The router shows Notes: leaves an open collection page, paints the cached list at once on the first show (else the loading note), then reads it quietly. */
  function show() {
    if (L.collections.page.isOpen()) {
      L.collections.page.close();
      state.status = 'loading';
      draw();
    }
    if (booted) return load(false);
    booted = true;
    var reading = load(true);
    if (!root.firstChild) draw();
    return reading;
  }

  /** Reads the notes into the cache while another tab is on screen, so the first switch here can paint them at once. */
  function warm() {
    return BujoNav.data.warm(BujoNav.data.KEYS.notes, fetchIndex);
  }

  window.addEventListener('online', onOnline);
  BujoNav.router.start('notes', { show: show, warm: warm });
})();
