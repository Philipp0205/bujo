/*
 * The collection page: one named page opened from the Notes index. Its entries are drawn with the log's own rows (the same bullet, done
 * toggle, important star, long press picker and edit sheet), under the name of the page, with a line at the bottom to add more.
 * Swipes and the page turn of the daily log are left out: a collection has no days. It draws into the root it is given and keeps
 * its own state. Needs everything the log rows need (view.js, done/, move/pick.js, type/picker.js, sheet.js, note/), plus
 * collections/copy.js, collections/model.js, api.js and ink/decorate.js.
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};
  L.collections = L.collections || {};

  var state = { collection: null, status: 'loading', entries: [] };
  var root = null;
  var back = null;
  var wired = false;
  var NO_SELECT = { on: function () { return false; }, ticked: function () { return false; }, toggle: function () {} };

  /** What a row does: a note opens the note sheet, any other entry the details sheet. The list is read again after a save. */
  var actions = {
    select: NO_SELECT,
    open: openEntry,
    toggleDone: function (entry) { L.done.toggle.toggle(entry.id); },
    add: function () {}
  };

  /** The page header: the name of the collection with its notebook page ("p. 12") when it has one, and the way back to the index. */
  function head() {
    var copy = L.collections.copy;
    var page = L.collections.model.pageOf(state.collection);
    return h('div', { class: 'paper-head' },
      h('h1', { 'data-testid': 'collection-title' }, state.collection.name),
      page === null ? null : h('span', { class: 'collection-page-mark', 'data-testid': 'collection-page-mark' }, copy.pageMark(page)),
      h('button', { class: 'paper-link collection-back', type: 'button', 'data-action': 'collection-back', 'aria-label': copy.backLabel, onclick: back }, copy.back));
  }

  /** The controls that manage the page: rename it, give it a notebook page number, or delete it (after a confirm). Small paper links under the title. */
  function tools() {
    var copy = L.collections.copy;
    return h('div', { class: 'collection-tools' },
      h('button', { class: 'paper-link', type: 'button', 'data-action': 'collection-rename', 'data-testid': 'collection-rename-open', onclick: rename }, copy.rename),
      h('button', { class: 'paper-link', type: 'button', 'data-action': 'collection-page', 'data-testid': 'collection-page-open', onclick: askPage }, copy.pageAction),
      h('button', { class: 'paper-link', type: 'button', 'data-action': 'collection-delete', 'data-testid': 'collection-delete-open', onclick: confirmRemove }, copy.delete));
  }

  /** Asks for the notebook page number, then shows it next to the title. */
  function askPage() {
    L.collections.chooser.askPage(state.collection, function (saved) {
      state.collection = saved;
      draw();
    });
  }

  /** Asks for a new name, then shows it as the title. */
  function rename() {
    L.collections.chooser.askRename(state.collection, function (renamed) {
      state.collection = renamed;
      draw();
    });
  }

  /** Asks to confirm, then deletes the page with its entries and photos (nothing returns to the log) and goes back to the index. */
  function confirmRemove() {
    L.collections.chooser.confirmDelete(state.collection, function () {
      return L.api.deleteCollection(state.collection.id).then(function () {
        L.collections.chooser.close();
        back();
      });
    });
  }

  /** The line at the bottom of the page that adds an entry: type it and press Enter (or Add). It is a task unless the line says otherwise. */
  function addLine() {
    var copy = L.collections.copy;
    var input = h('input', { class: 'collection-add-input', type: 'text', maxlength: 200, autocomplete: 'off', 'data-testid': 'collection-add-input', placeholder: copy.addPlaceholder, 'aria-label': copy.addPlaceholder });
    var form = h('form', { class: 'collection-add', novalidate: true }, input, h('button', { class: 'collection-add-save', type: 'submit', 'data-action': 'collection-add' }, copy.addSave));
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var values = L.collections.model.newEntry(input.value, L.dates.todayIso(), state.collection.id);
      if (values) add(values);
    });
    return form;
  }

  /** Saves a new entry on this page, then reads the page again. A refusal says so in a toast. */
  function add(values) {
    L.api.create(values).then(reload, function () { L.toast.show(L.collections.copy.addFailed, 'fail'); });
  }

  /** The rows of the page, one card each (the log's own card), or a quiet line when it is empty. */
  function rows() {
    var today = L.dates.todayIso();
    if (!state.entries.length) return h('p', { class: 'paper-state', 'data-state': 'empty', role: 'status' }, L.collections.copy.empty);
    return state.entries.map(function (entry) { return L.view.entryCard({ entry: entry, children: [] }, actions, today); });
  }

  /** The loading and error notes, or the rows with the add line. */
  function body() {
    if (state.status === 'ready') return h('section', { class: 'paper-day-group', 'data-testid': 'collection-page' }, tools(), rows(), addLine());
    var copy = L.collections.copy;
    var failed = state.status === 'error';
    var note = h('p', { class: 'paper-state', 'data-state': state.status, role: failed ? 'alert' : 'status' }, failed ? copy.loadFailed : copy.loading);
    return failed ? h('div', null, note, h('button', { class: 'paper-link', type: 'button', 'data-action': 'retry', onclick: reload }, copy.retry)) : note;
  }

  /** Draws the whole page from the state, then inks its cards. The page is small, so nothing is patched in place. */
  function draw() {
    if (!state.collection) return;
    root.replaceChildren(head(), h('div', { class: 'paper-page' }, body()));
    L.ink.decorate.list(root);
  }

  /** Opens a row: the note sheet for a note, otherwise the details sheet. Both read the page again after a save. */
  function openEntry(entry) {
    if (L.note.model.isNote(entry)) L.note.sheet.open({ mode: 'saved', values: L.note.model.fromEntry(entry), onSaved: reload });
    else L.sheet.open({ entry: entry, today: L.dates.todayIso(), onSaved: reload });
  }

  /** A saved entry takes its place in the list, or leaves it when it was filed on another page. The page is drawn by the caller. */
  function upsert(entry) {
    state.entries = state.entries.filter(function (item) { return item.id !== entry.id; });
    if (entry.collectionId === state.collection.id) state.entries.push(entry);
    state.entries.sort(function (a, b) { return a.position - b.position; });
  }

  /** An entry that left the page (filed into a note) is forgotten; a note that took it, if on this page, is swapped for its saved version. The page is drawn by the caller. */
  function remove(id, note) {
    state.entries = state.entries.filter(function (item) { return item.id !== id; }).map(function (item) { return note && item.id === note.id ? note : item; });
  }

  /** Reads the page from the server. */
  function reload() {
    return L.api.listCollection(state.collection.id).then(function (result) {
      state.entries = result.entries;
      state.collection = result.collection;
      state.status = 'ready';
      draw();
    }, function () {
      state.status = 'error';
      draw();
    });
  }

  /** The hosts of the done toggle, the move and the type picker are wired once: they read the entries of this page. */
  function wire() {
    if (wired) return;
    wired = true;
    var host = { entries: function () { return state.entries; }, today: L.dates.todayIso, upsert: upsert, remove: remove, paint: function () { if (state.collection) draw(); } };
    L.done.toggle.init({ root: root, select: NO_SELECT, host: host });
    L.move.pick.init({ root: root, select: NO_SELECT, host: host, swipe: false });
    L.type.picker.init({ root: root, select: NO_SELECT });
  }

  /** Opens a collection into the root: loading first, then its entries. onBack runs from the way back. */
  function open(into, collection, onBack) {
    root = into;
    back = onBack;
    state = { collection: collection, status: 'loading', entries: [] };
    wire();
    draw();
    return reload();
  }

  /** Leaves the page: nothing of it is drawn or refreshed any more. */
  function close() {
    state.collection = null;
  }

  /** True while a collection is open. */
  function isOpen() {
    return state.collection !== null;
  }

  L.collections.page = { open: open, close: close, isOpen: isOpen };
})();
