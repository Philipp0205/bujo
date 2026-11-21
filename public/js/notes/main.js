/*
 * The Notes screen: loads every free note, draws the grid and opens the note sheet on a tap. The state lives here and nowhere
 * else. The page registers with BujoNav.router, which shows it on a cold load of /notes and again whenever the Notes tab is tapped
 * (the page stays in the document, hidden, while another tab is on screen). The last list comes from AppKit.swr at once, so a
 * revisit never shows the loading note. Needs the notes files, the log api, ink and note sheet files, and the nav files.
 */
(function () {
  'use strict';

  var L = window.BujoLog;
  var B = window.BujoNotes;
  var root = document.getElementById('notes');
  var state = { status: 'loading', entries: [] };
  var booted = false;

  /** The grid, an empty note, or the loading and error notes, for the current status. */
  function body() {
    if (state.status !== 'ready') return B.view.stateNote(state.status, reload);
    if (!state.entries.length) return B.view.stateNote('empty');
    return B.view.groupList(B.model.groups(B.model.cards(state.entries)), open);
  }

  /** Draws the whole page from the state, then inks its cards. The page is small, so nothing is patched in place. */
  function draw() {
    root.replaceChildren(B.view.header(), AppKit.h('div', { class: 'paper-page' }, body()));
    L.ink.decorate.notes(root);
  }

  /** Opens the sheet of one note. After a save or a delete the list is read again. */
  function open(id) {
    var entry = state.entries.find(function (item) { return item.id === id; });
    if (entry) L.note.sheet.open({ mode: 'saved', values: L.note.model.fromEntry(entry), onSaved: reload });
  }

  /** Takes a list. The grid is only drawn again when it differs from what is on screen. */
  function accept(entries) {
    var same = state.status === 'ready' && JSON.stringify(entries) === JSON.stringify(state.entries);
    state.entries = entries;
    state.status = 'ready';
    if (!same) draw();
  }

  /** A failed read keeps the grid that is on screen, and shows the error note only when there is none. */
  function failed() {
    if (state.status === 'ready') return;
    state.status = 'error';
    draw();
  }

  /** Reads the notes through the cache. paintCache draws the last list at once when the screen has no list yet. */
  function load(paintCache) {
    var stale = paintCache ? function (entries) { if (state.status !== 'ready') accept(entries); } : null;
    return BujoNav.data.load(BujoNav.data.KEYS.notes, L.api.listNotes, { stale: stale, fresh: accept, fail: failed });
  }

  /** Reads the notes again with the loading note (after a save or a delete): the server alone, so the list holds that change. */
  function reload() {
    state.status = 'loading';
    draw();
    return BujoNav.data.fresh(BujoNav.data.KEYS.notes, L.api.listNotes).then(accept, failed);
  }

  /** The router shows Notes: paints the cached list at once on the first show (else the loading note), then reads it quietly. */
  function show() {
    if (booted) return load(false);
    booted = true;
    var reading = load(true);
    if (!root.firstChild) draw();
    return reading;
  }

  /** Reads the notes into the cache while another tab is on screen, so the first switch here can paint them at once. */
  function warm() {
    return BujoNav.data.warm(BujoNav.data.KEYS.notes, L.api.listNotes);
  }

  BujoNav.router.start('notes', { show: show, warm: warm });
})();
