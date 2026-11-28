/*
 * The tray of the scan camera screen: the photos taken so far and not yet read. It shows a counter, a strip of thumbnails (each with a small
 * remove x) and the Done button that hands the photos on. The pending rules (the max, adding, removing) are scan/batch.js; this file is the view.
 * A thumbnail is shown from a data: URL (the page's CSP allows data: images, not blob:), so no object URL is made and none has to be revoked;
 * the URL goes with its thumbnail when it is removed or the tray is cleared.
 * Needs ak-dom.js, copy.js, scan/copy.js, scan/batch.js, scan/progress.js and glyph.js.
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};
  L.scan = L.scan || {};

  /** One thumbnail for a file: the photo (shown once it is read and decoded) and its remove button. */
  function thumb(file, onRemove) {
    var img = h('img', { alt: '', hidden: true });
    img.addEventListener('load', function () { img.hidden = false; });
    L.scan.progress.dataUrl(file).then(function (url) { img.src = url; }, function () { img.hidden = true; });
    var remove = h('button', { class: 'scan-thumb-remove', type: 'button', 'data-action': 'thumb-remove', onclick: onRemove },
      L.glyph.use('g-close', { viewBox: '0 0 24 24', width: 16, height: 16 }));
    return { file: file, remove: remove, node: h('li', { class: 'scan-thumb', 'data-testid': 'scan-thumb' }, img, remove) };
  }

  /**
   * Creates the tray. options.onDone(files) runs when Done is tapped, options.onChange() after every change (the camera screen
   * uses it to disable the shutter at the max). The node is hidden while nothing is pending.
   */
  function create(options) {
    var copy = L.copy.scan.camera;
    var entries = [];
    var busy = false;
    var count = h('span', { class: 'scan-tray-count', 'data-testid': 'scan-count' });
    var done = h('button', { class: 'scan-done', type: 'button', 'data-action': 'scan-done', onclick: function () { options.onDone(files()); } }, copy.done);
    var strip = h('ul', { class: 'scan-strip', 'data-testid': 'scan-strip', 'aria-label': copy.stripLabel });
    var node = h('div', { class: 'scan-tray', 'data-testid': 'scan-tray', hidden: true }, h('div', { class: 'scan-tray-head' }, count, done), strip);

    function files() { return entries.map(function (entry) { return entry.file; }); }

    /** Redraws the counter, the strip and the spoken names from the entries. */
    function draw() {
      node.hidden = entries.length === 0;
      count.textContent = copy.count(entries.length, L.scan.batch.MAX_PAGES);
      done.disabled = busy;
      strip.replaceChildren.apply(strip, entries.map(function (entry) { return entry.node; }));
      entries.forEach(function (entry, at) {
        entry.remove.setAttribute('aria-label', copy.remove(at + 1));
        entry.remove.disabled = busy;
      });
      options.onChange();
    }

    function remove(entry) {
      entries = entries.filter(function (other) { return other !== entry; });
      draw();
    }

    /** Adds photos up to the max. True when some did not fit. */
    function add(picked) {
      var room = L.scan.batch.collect(files(), picked);
      room.pending.slice(entries.length).forEach(function (file) {
        var entry = thumb(file, function () { remove(entry); });
        entries.push(entry);
      });
      draw();
      return room.full;
    }

    draw();
    return {
      node: node,
      add: add,
      count: function () { return entries.length; },
      isFull: function () { return L.scan.batch.isFull(entries); },
      setBusy: function (on) { busy = on; draw(); }
    };
  }

  L.scan.tray = { create: create };
})();
