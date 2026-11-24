/*
 * File a task into a note: a paper overlay (the look of the collection chooser) that lists the free-form notes (the ones with a body, as
 * the Notes screen shows them) and adds the task's title as a new last line of the one tapped. The task then leaves its page. With no
 * free-form note yet it says so and offers the new-note sheet. A tap on the veil closes it with no pick.
 * Needs ak-dom.js, copy.js, api.js, toast.js, move/pick.js (gone, entryOf) and note/sheet.js, note/model.js (for a first note).
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};
  L.note = L.note || {};

  var overlay = null;

  /** Closes the chooser, if one is open. */
  function close() {
    if (overlay) overlay.remove();
    overlay = null;
  }

  /** Puts a card on the paper veil. A tap on the veil itself closes it. */
  function show(card) {
    close();
    overlay = h('div', {
      class: 'move-overlay collection-overlay', 'data-testid': 'into-overlay',
      onclick: function (event) { if (event.target === overlay) close(); }
    }, card);
    document.body.appendChild(overlay);
  }

  /** The task is on the note: the page drops it and says so. */
  function filed(entry, note) {
    close();
    L.move.pick.gone(entry.id, note);
    L.toast.show(L.copy.into.added, 'ok');
  }

  /** Files the entry into the note on the server. A refusal says so and leaves the page as it was. */
  function file(entry, note) {
    L.api.fileIntoNote(entry.id, note.id).then(function (result) { filed(entry, result.note); }, function () {
      close();
      L.toast.show(L.copy.into.failed, 'fail');
    });
  }

  /** One free-form note as a button: its title and day. */
  function choice(note, entry) {
    return h('button', {
      class: 'collection-choice', type: 'button', 'data-testid': 'into-choice', 'data-note-id': note.id, onclick: function () { file(entry, note); }
    }, h('span', { class: 'collection-choice-name' }, note.title || L.copy.note.untitled), h('span', { class: 'collection-choice-count' }, note.date));
  }

  /** With no free-form note: the quiet say-so, and a way to write the first one (the chooser opens again once it is saved). */
  function emptyCard(entry) {
    var copy = L.copy.into;
    var start = function () {
      close();
      L.note.sheet.open({ mode: 'new', values: L.note.model.blank(L.dates.todayIso()), onSaved: function () { open(entry); } });
    };
    return [h('p', { class: 'collection-note', 'data-testid': 'into-empty' }, copy.empty),
      h('button', { class: 'collection-leave', type: 'button', 'data-testid': 'into-new-note', onclick: start }, copy.newNote)];
  }

  /** The card for the list of notes. */
  function listCard(notes, entry) {
    var copy = L.copy.into;
    return h('div', { class: 'move-chooser collection-chooser', role: 'dialog', 'aria-label': copy.title, 'data-testid': 'into-chooser' },
      h('p', { class: 'collection-title' }, copy.title),
      notes.length ? notes.map(function (note) { return choice(note, entry); }) : emptyCard(entry));
  }

  /** Opens the chooser for an entry. The notes are read when it opens, so one written a moment ago is there. */
  function open(entry) {
    show(h('div', { class: 'move-chooser collection-chooser', 'data-testid': 'into-chooser' }, h('p', { class: 'collection-note' }, L.copy.into.loading)));
    L.api.listNotes().then(function (notes) {
      if (overlay) show(listCard(notes, entry));
    }, function () {
      if (overlay) show(h('div', { class: 'move-chooser collection-chooser' }, h('p', { class: 'collection-note', role: 'alert' }, L.copy.into.loadFailed)));
    });
  }

  L.note.into = { open: open, close: close };
})();
