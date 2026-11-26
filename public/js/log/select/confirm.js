/*
 * The delete confirm of select mode: a paper overlay (the look of the collection delete confirm) that says how many entries go.
 * Cancel or a tap on the veil closes it and calls nothing. Needs ak-dom.js, copy.js and the collection chooser styles.
 * options: count, onConfirm(). The dialog closes before onConfirm runs.
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};
  L.select = L.select || {};

  var overlay = null;

  /** Closes the confirm, if one is open. */
  function close() {
    if (overlay) overlay.remove();
    overlay = null;
  }

  /** The Cancel and Delete buttons. */
  function buttons(words, onConfirm) {
    var remove = h('button', {
      class: 'collection-leave collection-delete', type: 'button', 'data-action': 'select-delete-confirm', 'data-testid': 'select-delete-confirm',
      onclick: function () { close(); onConfirm(); }
    }, words.deleteConfirm);
    var cancel = h('button', {
      class: 'collection-leave', type: 'button', 'data-action': 'select-delete-cancel', 'data-testid': 'select-delete-cancel', onclick: close
    }, words.deleteCancel);
    return [remove, cancel];
  }

  /** Opens the confirm for this many entries. */
  function open(options) {
    var words = L.copy.select;
    close();
    var card = h('div', { class: 'move-chooser collection-chooser', role: 'dialog', 'aria-label': words.deleteTitle(options.count), 'data-testid': 'select-delete-dialog' },
      h('p', { class: 'collection-title', 'data-testid': 'select-delete-title' }, words.deleteTitle(options.count)),
      h('p', { class: 'collection-warning' }, words.deleteBody)
    );
    buttons(words, options.onConfirm).forEach(function (node) { card.appendChild(node); });
    overlay = h('div', {
      class: 'move-overlay collection-overlay', 'data-testid': 'select-delete-overlay',
      onclick: function (event) { if (event.target === overlay) close(); }
    }, card);
    document.body.appendChild(overlay);
  }

  L.select.confirm = { open: open, close: close };
})();
