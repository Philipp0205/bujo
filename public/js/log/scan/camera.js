/*
 * The scan camera screen (mock 03): a full-screen overlay with a frame, a mode toggle and a shutter.
 * The shutter opens the phone camera through a file input, so no live video and no photo is kept here.
 * Needs ak-dom.js, copy.js, scan/copy.js, scan/model.js and glyph.js.
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};
  L.scan = L.scan || {};
  var INPUT_ID = 'scan-file';

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

  /** The handle the flow drives: an error line, a busy state and close. */
  function controls(node, shutter, slot, copy) {
    return {
      /** Shows or clears one line of trouble. The camera stays open so the person can try again. */
      error: function (message) { Bujo.say(slot, message); },
      /** Busy: the shutter is off and the line says the page is being read. */
      busy: function (on) {
        shutter.disabled = on;
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
    var input = h('input', { id: INPUT_ID, class: 'scan-input', type: 'file', accept: 'image/*', capture: 'environment', tabindex: '-1' });
    var shutter = h('button', { class: 'scan-shutter', type: 'button', 'aria-label': copy.shutter, 'data-action': 'shutter', onclick: function () { input.click(); } });
    var title = h('h2', { class: 'scan-title', id: 'scan-title' }, copy.title);
    var close = h('button', { class: 'scan-close', type: 'button', 'aria-label': copy.close, 'data-action': 'scan-close', onclick: options.onClose },
      L.glyph.use('g-close', { viewBox: '0 0 24 24', width: 24, height: 24 }));
    var node = h('div', { class: 'scan-screen', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'scan-title', 'data-testid': 'scan-screen' },
      h('div', { class: 'scan-top' }, close, title), frame(), slot, modes(copy), shutter, input);

    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      input.value = '';
      if (file) options.onPhoto(file);
    });
    node.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') options.onClose();
    });
    document.body.appendChild(node);
    shutter.focus({ preventScroll: true });

    return controls(node, shutter, slot, copy);
  }

  L.scan.camera = { open: open };
})();
