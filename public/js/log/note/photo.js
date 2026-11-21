/*
 * The photo of a free note on its sheet: a thumbnail row, and a full-size view over the page when it is tapped.
 * The view is its own paper layer, not a kit sheet, because the kit shows one sheet at a time and the note sheet stays open under it.
 * Needs ak-dom.js, copy.js, glyph.js and nav/overlays.js. The view is a Back layer: the phone's Back closes it and leaves the note sheet open.
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};
  L.note = L.note || {};

  var opened = null;

  /** Closes the full-size view, if one is open, and gives the focus back to what opened it. */
  function closeView() {
    if (!opened) return;
    var view = opened;
    opened = null;
    window.removeEventListener('keydown', view.onKey, true);
    view.node.remove();
    BujoNav.overlays.release('photo');
    if (view.opener && view.opener.focus) view.opener.focus({ preventScroll: true });
  }

  /** Escape closes the view only: the capture listener stops the key before the note sheet below it can close too. */
  function onKey(event) {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    closeView();
  }

  /** Opens the photo at url over the whole screen. A tap anywhere, the close button or Escape closes it. */
  function openView(url, opener) {
    var copy = L.copy.note;
    if (opened) return;
    var close = h('button', { class: 'photo-view-close', type: 'button', 'aria-label': copy.photoClose, 'data-action': 'photo-close', onclick: closeView },
      L.glyph.use('g-close', { viewBox: '0 0 24 24', width: 24, height: 24 }));
    var node = h('div', { class: 'photo-view', role: 'dialog', 'aria-modal': 'true', 'aria-label': copy.photoAlt, 'data-testid': 'photo-view', onclick: closeView },
      h('img', { class: 'photo-view-img', src: url, alt: copy.photoAlt }), close);
    opened = { node: node, opener: opener, onKey: onKey };
    window.addEventListener('keydown', onKey, true);
    document.body.appendChild(node);
    close.focus({ preventScroll: true });
    BujoNav.overlays.open('photo', closeView);
  }

  /** The labelled thumbnail of a note photo. A tap opens the full-size view. */
  function field(url) {
    var copy = L.copy.note;
    var button = h('button', { class: 'note-photo', type: 'button', 'data-action': 'open-photo', 'aria-label': copy.photoOpen },
      h('img', { class: 'note-photo-img', src: url, alt: copy.photoAlt, 'data-testid': 'note-photo' }));
    button.addEventListener('click', function () { openView(url, button); });
    return h('div', { class: 'ak-field note-photo-field' }, h('span', { class: 'ak-label' }, copy.photoLabel), button);
  }

  L.note.photo = { field: field };
})();
