/*
 * The kept photos of a notebook page: a small thumbnail that opens the newest photo, and a full-screen viewer with a step through to
 * the older photos of the page. The viewer is its own paper layer and a Back layer (nav/overlays.js): the phone's Back closes it.
 * Needs ak-dom.js, index/copy.js, index/model.js, nav/overlays.js, log/glyph.js and log/api.js. A page is { number, photos: [{ id }] }.
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var I = window.BujoIndex = window.BujoIndex || {};
  var OVERLAY = 'page-photo';

  var opened = null;

  /** Closes the viewer, if one is open, and gives the focus back to what opened it. */
  function closeView() {
    if (!opened) return;
    var view = opened;
    opened = null;
    window.removeEventListener('keydown', view.onKey, true);
    view.node.remove();
    BujoNav.overlays.release(OVERLAY);
    if (view.opener && view.opener.focus) view.opener.focus({ preventScroll: true });
  }

  /** Escape closes the viewer only. */
  function onKey(event) {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    closeView();
  }

  /** Shows photo number `index` (0 is the newest) and the step button: older photos while there are some, then back to the newest. */
  function show(view, index) {
    var copy = I.copy.photo;
    var photos = view.photos;
    view.index = index;
    view.img.src = window.BujoLog.api.pagePhotoUrl(photos[index].id);
    view.img.setAttribute('data-index', String(index));
    if (!view.step) return;
    var older = photos.length - 1 - index;
    view.step.textContent = older > 0 ? copy.older(older) : copy.newest;
    view.step.setAttribute('aria-label', older > 0 ? copy.older(older) : copy.newest + ', ' + copy.position(index, photos.length));
  }

  /** Opens the photos of a page over the whole screen, the newest first. A tap on the photo, the close button or Escape closes it. */
  function openView(page, opener) {
    var copy = I.copy.photo;
    var label = I.model.labelOf(page);
    if (opened || !page.photos || !page.photos.length) return;
    var view = { photos: page.photos, index: 0, img: h('img', { class: 'photo-view-img', alt: copy.alt(label), 'data-testid': 'page-photo-img' }), step: null };
    var close = h('button', { class: 'photo-view-close', type: 'button', 'aria-label': copy.close, 'data-action': 'photo-close', onclick: closeView },
      window.BujoLog.glyph.use('g-close', { viewBox: '0 0 24 24', width: 24, height: 24 }));
    var parts = [view.img, close];
    if (page.photos.length > 1) {
      view.step = h('button', { class: 'photo-view-step', type: 'button', 'data-testid': 'page-photo-older',
        onclick: function (event) { event.stopPropagation(); show(view, (view.index + 1) % view.photos.length); } });
      parts.push(view.step);
    }
    view.node = h('div', { class: 'photo-view page-photo-view', role: 'dialog', 'aria-modal': 'true', 'aria-label': copy.alt(label), 'data-testid': 'page-photo-view', onclick: closeView }, parts);
    opened = { node: view.node, opener: opener, onKey: onKey };
    window.addEventListener('keydown', onKey, true);
    document.body.appendChild(view.node);
    show(view, 0);
    close.focus({ preventScroll: true });
    BujoNav.overlays.open(OVERLAY, closeView);
  }

  /** True when the page has at least one kept photo. */
  function has(page) {
    return !!(page && page.photos && page.photos.length);
  }

  /** The small thumbnail button of a page's newest photo, or null when it has none. A tap opens the viewer. */
  function thumb(page) {
    if (!has(page)) return null;
    var copy = I.copy.photo;
    var label = I.model.labelOf(page);
    var button = h('button', { class: 'page-thumb', type: 'button', 'data-testid': 'page-thumb', 'aria-label': copy.thumbLabel(label) },
      h('img', { class: 'page-thumb-img', src: window.BujoLog.api.pagePhotoUrl(page.photos[0].id), alt: '', loading: 'lazy' }));
    button.addEventListener('click', function () { openView(page, button); });
    return button;
  }

  I.photo = { has: has, thumb: thumb, open: openView };
})();
