/*
 * Boots the Notes screen: loads every free note, draws the grid and opens the note sheet on a tap. The state lives here
 * and nowhere else. Needs the notes files, the log api, ink and note sheet files, and the nav files.
 */
(function () {
  'use strict';

  var L = window.BujoLog;
  var B = window.BujoNotes;
  var root = document.getElementById('notes');
  var state = { status: 'loading', entries: [] };

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

  function load() {
    return L.api.listNotes().then(function (entries) {
      state.entries = entries;
      state.status = 'ready';
    }, function () {
      state.status = 'error';
    }).then(draw);
  }

  /** Reads the notes again with the loading note. */
  function reload() {
    state.status = 'loading';
    draw();
    return load();
  }

  AppKit.themeColor.start();
  AppKit.sw.register({ url: '/sw.js', scope: '/' });
  BujoNav.tabs.mount('notes');
  draw();
  load();
})();
