/*
 * The collection chooser: a paper overlay (the look of the move chooser) that lists the collections, files an entry on the one tapped,
 * names a new one on the spot, and (for an entry already on a page) takes it back to the daily log. askName() is the same naming form
 * alone, for the Notes index; askRename() and confirmDelete() serve the collection page. A tap on the veil closes it with no pick.
 * No saving of its own for a pick: it goes to options.onSaved(body).
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

  /** The naming form: one input and a button. send(name) saves the name and answers a promise; onDone(result) runs once the server has it. fail(error) words a refusal. */
  function nameForm(form) {
    var copy = L.collections.copy;
    var input = h('input', {
      class: 'collection-name', type: 'text', maxlength: 60, autocomplete: 'off', 'data-testid': 'collection-name',
      placeholder: copy.namePlaceholder, 'aria-label': copy.nameLabel, value: form.initial || ''
    });
    var note = h('p', { class: 'collection-note', role: 'status', 'data-testid': 'collection-note' });
    var node = h('form', { class: 'collection-form', novalidate: true }, input, h('button', { class: 'collection-create', type: 'submit', 'data-action': form.action }, form.button), note);
    node.addEventListener('submit', function (event) {
      event.preventDefault();
      var name = L.collections.model.cleanName(input.value);
      if (!name) { note.textContent = copy.nameRequired; return; }
      note.textContent = '';
      form.send(name).then(form.onDone, function (error) { note.textContent = form.fail(error); });
    });
    return node;
  }

  /** The form that makes a new collection. */
  function createForm(onCreated) {
    var copy = L.collections.copy;
    return nameForm({ action: 'create-collection', button: copy.nameCreate, send: L.api.createCollection, onDone: onCreated, fail: function () { return copy.nameFailed; } });
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
      createForm(pick));
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
      createForm(function (collection) { close(); onCreated(collection); })));
    overlay.querySelector('input').focus();
  }

  /** Opens the naming form filled with the page's name. onRenamed(collection) runs once the server has the new name. A taken name says so. */
  function askRename(collection, onRenamed) {
    var copy = L.collections.copy;
    var form = nameForm({
      action: 'rename-collection', button: copy.renameSave, initial: collection.name,
      send: function (name) { return L.api.renameCollection(collection.id, name); },
      onDone: function (renamed) { close(); onRenamed(renamed); },
      fail: function (error) { return error && error.status === 409 ? copy.nameTaken : copy.renameFailed; }
    });
    show(h('div', { class: 'move-chooser collection-chooser', role: 'dialog', 'aria-label': copy.renameTitle, 'data-testid': 'collection-rename' }, h('p', { class: 'collection-title' }, copy.renameTitle), form));
    overlay.querySelector('input').focus();
  }

  /** The page number form: a numeric input, Save, and "No page number" to clear. send(page|null) saves; the server's text shows when it refuses (400). */
  function pageForm(collection, onSaved) {
    var copy = L.collections.copy;
    var current = L.collections.model.pageOf(collection);
    var input = h('input', {
      class: 'collection-name collection-page-input', type: 'text', inputmode: 'numeric', pattern: '[0-9]*', maxlength: 4, autocomplete: 'off',
      'data-testid': 'collection-page-input', placeholder: copy.pagePlaceholder, 'aria-label': copy.pageLabel, value: current === null ? '' : String(current)
    });
    var note = h('p', { class: 'collection-note', role: 'status', 'data-testid': 'collection-note' });
    var clear = h('button', { class: 'collection-leave', type: 'button', 'data-action': 'clear-page', 'data-testid': 'collection-page-clear' }, copy.pageClear);
    var node = h('form', { class: 'collection-form', novalidate: true }, input, h('button', { class: 'collection-create', type: 'submit', 'data-action': 'save-page' }, copy.pageSave), note);
    function send(page) {
      note.textContent = '';
      L.api.setCollectionPage(collection.id, page).then(function (saved) { close(); onSaved(saved); }, function (error) {
        note.textContent = error && error.status === 400 && error.message ? error.message : copy.pageFailed;
      });
    }
    node.addEventListener('submit', function (event) {
      event.preventDefault();
      var page = L.collections.model.parsePage(input.value);
      if (!page.ok) { note.textContent = copy.pageInvalid; return; }
      send(page.value);
    });
    clear.addEventListener('click', function () { send(null); });
    return [node, clear];
  }

  /** Opens the page number form for a collection. onSaved(collection) runs once the server has the number (or its removal). */
  function askPage(collection, onSaved) {
    var copy = L.collections.copy;
    var parts = pageForm(collection, onSaved);
    show(h('div', { class: 'move-chooser collection-chooser', role: 'dialog', 'aria-label': copy.pageTitle, 'data-testid': 'collection-page-sheet' }, h('p', { class: 'collection-title' }, copy.pageTitle), parts[0], parts[1]));
    overlay.querySelector('input').focus();
  }

  /** Opens the delete confirm: says the page goes with its entries and photos. onConfirm runs on Delete; Cancel (or the veil) leaves everything as it is. */
  function confirmDelete(collection, onConfirm) {
    var copy = L.collections.copy;
    var note = h('p', { class: 'collection-note', role: 'alert', 'data-testid': 'collection-note' });
    var remove = h('button', { class: 'collection-leave collection-delete', type: 'button', 'data-action': 'confirm-delete', 'data-testid': 'collection-delete-confirm' }, copy.deleteConfirm);
    remove.addEventListener('click', function () {
      note.textContent = '';
      onConfirm().catch(function () { note.textContent = copy.deleteFailed; });
    });
    var cancel = h('button', { class: 'collection-leave', type: 'button', 'data-action': 'cancel-delete', 'data-testid': 'collection-delete-cancel', onclick: close }, copy.deleteCancel);
    show(h('div', { class: 'move-chooser collection-chooser', role: 'dialog', 'aria-label': copy.deleteTitle(collection.name), 'data-testid': 'collection-confirm' },
      h('p', { class: 'collection-title' }, copy.deleteTitle(collection.name)),
      h('p', { class: 'collection-warning' }, copy.deleteBody),
      remove, cancel, note));
  }

  L.collections.chooser = { open: open, askName: askName, askRename: askRename, askPage: askPage, confirmDelete: confirmDelete, close: close };
})();
