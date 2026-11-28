/*
 * The delete confirm of a saved note: a paper overlay in the look of the collection and select delete confirms. Delete asks the server to
 * remove the note (local only, never Nextcloud) and then calls onDone; Cancel or a tap on the veil closes it and changes nothing.
 * Needs ak-dom.js, copy.js (L.copy.note), api.js and the collection chooser styles.
 * options: title (the note's title), onConfirm() (answers a promise: a refusal keeps the confirm open and says so).
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};
  L.note = L.note || {};

  var overlay = null;

  /** Closes the confirm, if one is open. */
  function close() {
    if (overlay) overlay.remove();
    overlay = null;
  }

  /** The Delete and Cancel buttons. A failed delete says so under them and leaves the note alone. */
  function buttons(words, note, onConfirm) {
    var remove = h('button', { class: 'collection-leave collection-delete', type: 'button', 'data-action': 'note-delete-confirm', 'data-testid': 'note-delete-confirm' }, words.deleteConfirm);
    remove.addEventListener('click', function () {
      note.textContent = '';
      onConfirm().then(close, function () { note.textContent = words.deleteFailed; });
    });
    var cancel = h('button', { class: 'collection-leave', type: 'button', 'data-action': 'note-delete-cancel', 'data-testid': 'note-delete-cancel', onclick: close }, words.deleteCancel);
    return [remove, cancel];
  }

  /** Opens the confirm for one note. */
  function open(options) {
    var words = L.copy.note;
    var title = options.title || words.untitled;
    close();
    var note = h('p', { class: 'collection-note', role: 'alert', 'data-testid': 'note-delete-note' });
    var card = h('div', { class: 'move-chooser collection-chooser', role: 'dialog', 'aria-label': words.deleteTitle(title), 'data-testid': 'note-delete-dialog' },
      h('p', { class: 'collection-title', 'data-testid': 'note-delete-title' }, words.deleteTitle(title)),
      h('p', { class: 'collection-warning' }, words.deleteBody));
    buttons(words, note, options.onConfirm).forEach(function (node) { card.appendChild(node); });
    card.appendChild(note);
    overlay = h('div', {
      class: 'move-overlay collection-overlay', 'data-testid': 'note-delete-overlay',
      onclick: function (event) { if (event.target === overlay) close(); }
    }, card);
    document.body.appendChild(overlay);
  }

  L.note.remove = { open: open, close: close };
})();
