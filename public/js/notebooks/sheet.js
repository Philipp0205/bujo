/*
 * The start-a-notebook sheet: a paper overlay (the look of the collection chooser) with a name and a page count. Save starts the
 * notebook on the server (the one in use ends today) and hands it to onStarted. A tap on the veil closes it with nothing started.
 * Needs ak-dom.js, notebooks/copy.js, notebooks/model.js, log/api.js and the collection chooser's styles (css/collections.css).
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var N = window.BujoNotebooks = window.BujoNotebooks || {};

  var overlay = null;

  /** Closes the sheet, if one is open. */
  function close() {
    if (overlay) overlay.remove();
    overlay = null;
  }

  /** A one-line text field of the sheet. */
  function field(testid, label, placeholder, value, extra) {
    return h('input', Object.assign({
      class: 'collection-name notebook-field', type: 'text', autocomplete: 'off', 'data-testid': testid,
      placeholder: placeholder, 'aria-label': label, value: value
    }, extra));
  }

  /** A field with its caption over it, on a row of its own. */
  function captioned(caption, input) {
    return h('label', { class: 'notebook-field-row' }, h('span', { class: 'notebook-caption' }, caption), input);
  }

  /** The words for a refusal: the server's own text for a bad value (400), else the general failure. */
  function failure(error) {
    return error && error.status === 400 && error.message ? error.message : N.copy.startFailed;
  }

  /** The form: name and pages, one button, one quiet line for a refusal. Submit checks them, then starts the notebook. */
  function form(suggested, onStarted) {
    var copy = N.copy;
    var name = field('notebook-name-input', copy.nameLabel, copy.namePlaceholder, suggested, { maxlength: 60 });
    var pages = field('notebook-pages-input', copy.pagesLabel, copy.pagesPlaceholder, copy.defaultPages, { inputmode: 'numeric', pattern: '[0-9]*', maxlength: 4 });
    var note = h('p', { class: 'collection-note', role: 'status', 'data-testid': 'notebook-note' });
    var node = h('form', { class: 'collection-form', novalidate: true }, captioned(copy.nameCaption, name), captioned(copy.pagesCaption, pages),
      h('button', { class: 'collection-create', type: 'submit', 'data-action': 'save-notebook', 'data-testid': 'notebook-save' }, copy.sheetSave), note);
    node.addEventListener('submit', function (event) {
      event.preventDefault();
      var title = name.value.trim().replace(/\s+/g, ' ');
      var count = N.model.parsePages(pages.value);
      if (!title) { note.textContent = copy.nameRequired; return; }
      if (!count.ok) { note.textContent = copy.pagesInvalid; return; }
      note.textContent = '';
      window.BujoLog.api.startNotebook(title, count.value).then(function (notebook) { close(); onStarted(notebook); }, function (error) { note.textContent = failure(error); });
    });
    return node;
  }

  /** Opens the sheet. suggested is the name filled in; onStarted(notebook) runs once the server has the new notebook. */
  function open(suggested, onStarted) {
    close();
    var copy = N.copy;
    var card = h('div', { class: 'move-chooser collection-chooser', role: 'dialog', 'aria-label': copy.sheetTitle, 'data-testid': 'notebook-sheet' },
      h('p', { class: 'collection-title' }, copy.sheetTitle),
      h('p', { class: 'collection-note' }, copy.sheetNote),
      form(suggested, onStarted));
    overlay = h('div', { class: 'move-overlay collection-overlay', 'data-testid': 'notebook-overlay', onclick: function (event) { if (event.target === overlay) close(); } }, card);
    document.body.appendChild(overlay);
    overlay.querySelector('input').focus();
  }

  N.sheet = { open: open, close: close };
})();
