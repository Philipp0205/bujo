/*
 * The collection chooser: a paper overlay (the look of the move chooser) that lists the collections, files an entry on the one tapped,
 * names a new one on the spot, and (for an entry already on a page) takes it back to the daily log. askName() is the same naming form
 * alone, for the Notes index. A tap on the veil closes it with no pick. No saving of its own: a pick goes to options.onSaved(body).
 * Needs ak-dom.js, copy.js (the collection copy), collections/model.js, dates.js and api.js.
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};
  L.collections = L.collections || {};

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
      class: 'move-overlay collection-overlay', 'data-testid': 'collection-overlay',
      onclick: function (event) { if (event.target === overlay) close(); }
    }, card);
    document.body.appendChild(overlay);
  }

  /** The naming form: one input and a Create button. onCreated(collection) runs once the server has the new page. */
  function nameForm(onCreated) {
    var copy = L.collections.copy;
    var input = h('input', {
      class: 'collection-name', type: 'text', maxlength: 60, autocomplete: 'off', 'data-testid': 'collection-name',
      placeholder: copy.namePlaceholder, 'aria-label': copy.nameLabel
    });
    var note = h('p', { class: 'collection-note', role: 'status', 'data-testid': 'collection-note' });
    var form = h('form', { class: 'collection-form', novalidate: true }, input, h('button', { class: 'collection-create', type: 'submit', 'data-action': 'create-collection' }, copy.nameCreate), note);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var name = L.collections.model.cleanName(input.value);
      if (!name) { note.textContent = copy.nameRequired; return; }
      note.textContent = '';
      L.api.createCollection(name).then(onCreated, function () { note.textContent = copy.nameFailed; });
    });
    return form;
  }

  /** One collection as a button: its name and how many entries it holds. The page the entry is on is marked pressed. */
  function choice(collection, entry, onPick) {
    return h('button', {
      class: 'collection-choice', type: 'button', 'data-testid': 'collection-choice', 'data-collection-id': collection.id,
      'aria-pressed': entry.collectionId === collection.id ? 'true' : 'false', onclick: function () { onPick(collection); }
    }, h('span', { class: 'collection-choice-name' }, collection.name), h('span', { class: 'collection-choice-count' }, L.collections.copy.count(collection.count)));
  }

  /** The "back to the daily log" row, for an entry that sits on a page. */
  function leaveRow(onLeave) {
    return h('button', { class: 'collection-leave', type: 'button', 'data-testid': 'collection-leave', onclick: onLeave }, L.collections.copy.backToLog);
  }

  /** The card for a list of collections. */
  function listCard(collections, options) {
    var copy = L.collections.copy;
    var pick = function (collection) { close(); options.onSaved(L.collections.model.fileBody(collection.id)); };
    var leave = function () { close(); options.onSaved(L.collections.model.leaveBody(L.dates.todayIso())); };
    return h('div', { class: 'move-chooser collection-chooser', role: 'dialog', 'aria-label': copy.chooserTitle, 'data-testid': 'collection-chooser' },
      h('p', { class: 'collection-title' }, copy.chooserTitle),
      collections.length ? collections.map(function (collection) { return choice(collection, options.entry, pick); }) : h('p', { class: 'collection-note' }, copy.chooserEmpty),
      options.entry.collectionId ? leaveRow(leave) : null,
      nameForm(pick));
  }

  /** Opens the chooser for options.entry. The list is read when it opens, so a collection made elsewhere is there. */
  function open(options) {
    show(h('div', { class: 'move-chooser collection-chooser', 'data-testid': 'collection-chooser' }, h('p', { class: 'collection-note' }, L.collections.copy.loading)));
    L.api.listCollections().then(function (collections) {
      if (overlay) show(listCard(collections, options));
    }, function () {
      if (overlay) show(h('div', { class: 'move-chooser collection-chooser' }, h('p', { class: 'collection-note', role: 'alert' }, L.collections.copy.chooserLoadFailed)));
    });
  }

  /** Opens the naming form alone, to make a new collection. onCreated(collection) runs once it exists. */
  function askName(onCreated) {
    var copy = L.collections.copy;
    show(h('div', { class: 'move-chooser collection-chooser', role: 'dialog', 'aria-label': copy.nameTitle, 'data-testid': 'collection-ask' },
      h('p', { class: 'collection-title' }, copy.nameTitle),
      nameForm(function (collection) { close(); onCreated(collection); })));
    overlay.querySelector('input').focus();
  }

  L.collections.chooser = { open: open, askName: askName, close: close };
})();
