/*
 * The scan camera screen (mock 03): a full-screen overlay with a frame, a mode toggle, a gallery button and a shutter.
 * The shutter opens the phone camera and the gallery button the photo library, each through a file input,
 * so no live video and no photo is kept here.
 * Needs ak-dom.js, copy.js, scan/copy.js, scan/model.js and glyph.js.
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};
  L.scan = L.scan || {};
  var INPUT_ID = 'scan-file';
  var GALLERY_ID = 'scan-gallery';

  /** The dot grid frame with a guide symbol (a bullet and a line) so the page is lined up the right way. */
  function frame() {
    return h('div', { class: 'scan-frame', 'aria-hidden': 'true' }, L.glyph.use('g-scan-guide', { viewBox: '0 0 120 160' }));
  }

  /** The Rapid log / Free note switch. Free note is shown and disabled: it is not built yet. */
  function modes(copy) {
    return h('div', { class: 'scan-modes', role: 'group', 'aria-label': copy.modes },
      h('button', { class: 'scan-mode', type: 'button', 'aria-pressed': 'true', 'data-mode': 'rapid' }, copy.rapid),
      h('button', {
        class: 'scan-mode',
        type: 'button',
        'aria-pressed': 'false',
        'aria-disabled': 'true',
        title: copy.noteLater,
        'data-mode': 'note',
        onclick: function (event) { event.preventDefault(); }
      }, copy.note));
  }

  /** A hidden file input. Only the camera one sets capture, so the gallery one can pick any existing photo. */
  function fileInput(id, capture) {
    var attrs = { id: id, class: 'scan-input', type: 'file', accept: 'image/*', tabindex: '-1' };
    if (capture) attrs.capture = capture;
    return h('input', attrs);
  }

  /** Sends the first picked file to the same photo flow, then clears the input so the same photo can be picked again. */
  function feed(input, onPhoto) {
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      input.value = '';
      if (file) onPhoto(file);
    });
  }

  /** The actions row under the mode toggle: the gallery button left of the shutter. Each button opens its input. */
  function actions(copy, cameraInput, galleryInput) {
    var gallery = h('button', {
      class: 'scan-gallery',
      type: 'button',
      'aria-label': copy.gallery,
      'data-action': 'gallery',
      onclick: function () { galleryInput.click(); }
    }, L.glyph.use('g-gallery', { viewBox: '0 0 24 24', width: 24, height: 24 }));
    var shutter = h('button', { class: 'scan-shutter', type: 'button', 'aria-label': copy.shutter, 'data-action': 'shutter', onclick: function () { cameraInput.click(); } });
    return { row: h('div', { class: 'scan-actions' }, gallery, shutter), gallery: gallery, shutter: shutter };
  }

  /** The handle the flow drives: an error line, a busy state and close. */
  function controls(node, buttons, slot, copy) {
    return {
      /** Shows or clears one line of trouble. The camera stays open so the person can try again. */
      error: function (message) { Bujo.say(slot, message); },
      /** Busy: the shutter and the gallery button are off and the line says the page is being read. */
      busy: function (on) {
        buttons.shutter.disabled = on;
        buttons.gallery.disabled = on;
        node.setAttribute('aria-busy', on ? 'true' : 'false');
        if (on) slot.replaceChildren(h('p', { class: 'scan-busy', role: 'status', 'data-testid': 'scan-busy' }, copy.busy));
        else if (slot.querySelector('.scan-busy')) slot.replaceChildren();
      },
      close: function () { node.remove(); }
    };
  }

  /** Opens the screen. options.onPhoto(file) gets a photo the model accepted, options.onClose() the close button. */
  function open(options) {
    var copy = L.copy.scan.camera;
    var slot = h('div', { class: 'scan-slot', 'aria-live': 'polite' });
    var cameraInput = fileInput(INPUT_ID, 'environment');
    var galleryInput = fileInput(GALLERY_ID, null);
    var buttons = actions(copy, cameraInput, galleryInput);
    var title = h('h2', { class: 'scan-title', id: 'scan-title' }, copy.title);
    var close = h('button', { class: 'scan-close', type: 'button', 'aria-label': copy.close, 'data-action': 'scan-close', onclick: options.onClose },
      L.glyph.use('g-close', { viewBox: '0 0 24 24', width: 24, height: 24 }));
    var node = h('div', { class: 'scan-screen', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'scan-title', 'data-testid': 'scan-screen' },
      h('div', { class: 'scan-top' }, close, title), frame(), slot, modes(copy), buttons.row, cameraInput, galleryInput);

    feed(cameraInput, options.onPhoto);
    feed(galleryInput, options.onPhoto);
    node.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') options.onClose();
    });
    document.body.appendChild(node);
    buttons.shutter.focus({ preventScroll: true });

    return controls(node, buttons, slot, copy);
  }

  L.scan.camera = { open: open };
})();
