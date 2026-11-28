/*
 * The scan camera screen (mock 03 and 04): a full-screen overlay with a frame, a day row, a gallery button and a shutter.
 * One photo from the shutter is added to the pages taken (scan/tray.js) and Done sends them on; the gallery hands over several pages at once,
 * or adds to the pages taken when there are some. The flow reads the pages one after another (one page reads like a lone photo).
 * Whether a page is a log or a note is decided in the review, not here.
 * The shutter opens the phone camera and the gallery button the photo library, each through a file input,
 * so no live video is shown and no photo is kept past the scan. While a photo is read, the dot frame gives way to the progress state (progress.js).
 * Needs ak-dom.js, copy.js, scan/copy.js, scan/model.js, scan/batch.js, scan/tray.js, scan/progress.js, glyph.js and nav/overlays.js. It is a Back layer: Back closes it like the close button.
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};
  L.scan = L.scan || {};
  var INPUT_ID = 'scan-file';
  var GALLERY_ID = 'scan-gallery';

  /** The dot grid frame with a guide symbol: a bullet and a line. */
  function frame() {
    return h('div', { class: 'scan-frame', 'aria-hidden': 'true' }, L.glyph.use('g-scan-guide', { viewBox: '0 0 120 160' }));
  }

  /**
   * The day row: the day the page files on and a date input over it. Changing the day marks it picked, which beats the date on the page.
   * pick() is the picked day, or null while it is still the default.
   */
  function dayRow(copy, day) {
    var picked = null;
    var text = h('span', { class: 'scan-pickday-text', 'data-testid': 'scan-pick-text' });
    var note = h('span', { class: 'scan-pickday-note', 'data-testid': 'scan-pick-note' });
    var input = h('input', { class: 'scan-pickday-input', type: 'date', 'aria-label': copy.dayLabel, 'data-field': 'scan-day', value: day });
    function show() {
      text.textContent = copy.day(L.dates.dayHeading(picked || day));
      note.textContent = picked ? copy.dayPicked : copy.dayDefault;
    }
    input.addEventListener('change', function () {
      if (!input.value) return;
      picked = input.value;
      show();
    });
    show();
    var node = h('label', { class: 'scan-pickday', 'data-testid': 'scan-pick' }, text, note, input);
    return { node: node, pick: function () { return picked; } };
  }

  /** A hidden file input. Only the camera one sets capture, so the gallery one can pick any existing photo, and only the gallery one takes several. */
  function fileInput(id, capture) {
    var attrs = { id: id, class: 'scan-input', type: 'file', accept: 'image/*', tabindex: '-1' };
    if (capture) attrs.capture = capture;
    else attrs.multiple = true;
    return h('input', attrs);
  }

  /** Sends the picked files to the same photo flow, then clears the input so the same photos can be picked again. */
  function feed(input, onPhotos) {
    input.addEventListener('change', function () {
      var files = Array.prototype.slice.call(input.files || []);
      input.value = '';
      if (files.length) onPhotos(files);
    });
  }

  /** The actions row under the day row: the gallery button left of the shutter. Each button opens its input. */
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

  /** Swaps the dot frame for the progress state while photos are read, and back. show() takes the photo and an optional step line. */
  function workingState(node, guide) {
    var current = null;
    function hide() {
      if (!current) return;
      current.stop();
      node.replaceChild(guide, current.node);
      current = null;
    }
    return {
      show: function (file, text) {
        if (current) return;
        current = L.scan.progress.start(file, text);
        node.replaceChild(current.node, guide);
      },
      hide: hide,
      /** Shows the next photo of a batch: the progress state starts over for it. */
      next: function (file, text) {
        hide();
        current = L.scan.progress.start(file, text);
        node.replaceChild(current.node, guide);
      },
      stop: function () { if (current) current.stop(); }
    };
  }

  /** The handle the flow drives: an error line, a busy state and close. setBusy(on) greys the buttons and the tray. */
  function controls(node, setBusy, slot, working) {
    return {
      /** Shows or clears one line of trouble. The camera stays open so the person can try again. */
      error: function (message) { Bujo.say(slot, message); },
      /** Busy: the shutter, the gallery button and the tray are off and the progress state shows the photo (file) being read, with an optional step line. */
      busy: function (on, file, text) {
        setBusy(on);
        node.setAttribute('aria-busy', on ? 'true' : 'false');
        if (on) working.show(file, text);
        else working.hide();
      },
      /** Moves the busy state on to the next photo of a batch. */
      reading: function (file, text) { working.next(file, text); },
      close: function () {
        working.stop();
        node.remove();
        BujoNav.overlays.release('camera');
      }
    };
  }

  /**
   * Opens the screen. options.day is the day it offers to file on, options.onPhotos(files, pickedDay) gets the photos (the pages taken
   * with the shutter once Done is tapped, or the gallery's pick) and the day the person picked on this screen (null when they did not), options.onClose() the close button.
   * With options.single (a rescan of one page or note) a shutter photo goes straight to onPhotos, as there is nothing to collect.
   * With options.autoCapture the camera input opens at once (call it inside a tap, or the browser may refuse); the screen stays up under it.
   */
  function open(options) {
    var copy = L.copy.scan.camera;
    var slot = h('div', { class: 'scan-slot', 'aria-live': 'polite' });
    var cameraInput = fileInput(INPUT_ID, 'environment');
    var galleryInput = fileInput(GALLERY_ID, null);
    var buttons = actions(copy, cameraInput, galleryInput);
    var title = h('h2', { class: 'scan-title', id: 'scan-title' }, copy.title);
    var close = h('button', { class: 'scan-close', type: 'button', 'aria-label': copy.close, 'data-action': 'scan-close', onclick: options.onClose },
      L.glyph.use('g-close', { viewBox: '0 0 24 24', width: 24, height: 24 }));
    var pickDay = dayRow(copy, options.day);
    var guide = frame();
    var hint = h('p', { class: 'scan-hint', 'data-testid': 'scan-gallery-hint' });
    var busy = false;
    var tray = null;

    /** Greys the shutter at the max or while busy, and words the hint for it. */
    function sync() {
      var full = !!tray && tray.isFull();
      buttons.shutter.disabled = busy || full;
      buttons.gallery.disabled = busy;
      hint.textContent = full ? copy.maxHint(L.scan.batch.MAX_PAGES) : copy.galleryHint(L.scan.batch.MAX_PAGES);
    }
    tray = L.scan.tray.create({ onDone: function (files) { options.onPhotos(files, pickDay.pick()); }, onChange: sync });
    var node = h('div', { class: 'scan-screen', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'scan-title', 'data-testid': 'scan-screen' },
      h('div', { class: 'scan-top' }, close, title), guide, slot, pickDay.node, tray.node, buttons.row, hint, cameraInput, galleryInput);

    /** The pages the person adds: they wait in the tray for Done, and a pick past the max says so. */
    function take(files) {
      Bujo.say(slot, tray.add(files) ? L.copy.scan.errors.tooMany(L.scan.batch.MAX_PAGES) : '');
    }
    function photos(files) { options.onPhotos(files, pickDay.pick()); }
    feed(cameraInput, options.single ? photos : take);
    feed(galleryInput, function (files) { if (tray.count()) take(files); else photos(files); });
    node.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') options.onClose();
    });
    document.body.appendChild(node);
    buttons.shutter.focus({ preventScroll: true });
    BujoNav.overlays.open('camera', options.onClose);
    if (options.autoCapture) cameraInput.click();

    function setBusy(on) { busy = on; tray.setBusy(on); sync(); }
    return controls(node, setBusy, slot, workingState(node, guide));
  }

  L.scan.camera = { open: open };
})();
