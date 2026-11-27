/*
 * The OCR progress state of the scan screen: the page photo with a shimmer moving over it, a step line and the elapsed time.
 * It stands in for the dot frame while a photo is read, so the person can see the work is running and has not frozen.
 * The photo is shown from a data: URL (the page's CSP allows data: images, not blob:) and is never kept past the screen.
 * Needs ak-dom.js and scan/copy.js. The timer is stopped by stop(), which the camera calls when the state goes.
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};
  L.scan = L.scan || {};
  var TICK_MS = 500;

  /** A data: URL for the photo. Rejects when the file cannot be read. */
  function dataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsDataURL(file);
    });
  }

  /** The photo box: the photo with the shimmer layer over it. The photo stays hidden until the browser has decoded it. */
  function photoBox(img) {
    return h('div', { class: 'scan-progress-photo', 'aria-hidden': 'true' }, img, h('span', { class: 'scan-progress-shimmer' }));
  }

  /** Shows the photo in the img when it is read and can be decoded. */
  function loadPhoto(img, file, alive) {
    img.addEventListener('error', function () { img.hidden = true; });
    dataUrl(file).then(function (url) {
      if (alive()) img.src = url;
    }, function () { img.hidden = true; });
  }

  /** Ticks the elapsed line from the clock, so a slow timer cannot make it drift. Returns the function that stops it. */
  function tick(line, copy) {
    var began = Date.now();
    var timer = window.setInterval(function () {
      line.textContent = copy.elapsed(Math.floor((Date.now() - began) / 1000));
    }, TICK_MS);
    return function () { window.clearInterval(timer); };
  }

  /** Starts the progress state for a photo; text is the step line (the page of a batch), else the single-page one.
   * Returns { node, stop }: put node in the screen, call stop() when it goes. */
  function start(file, text) {
    var copy = L.copy.scan.progress;
    var img = h('img', { class: 'scan-progress-img', alt: '', hidden: true });
    var elapsed = h('p', { class: 'scan-progress-time', 'data-testid': 'scan-elapsed' }, copy.elapsed(0));
    var node = h('div', { class: 'scan-progress', 'data-testid': 'scan-progress' },
      photoBox(img),
      h('div', { class: 'scan-progress-text' },
        h('p', { class: 'scan-progress-step', role: 'status', 'data-testid': 'scan-step' }, text || copy.step),
        elapsed,
        h('p', { class: 'scan-progress-hint' }, copy.hint)));
    var stopped = false;
    var stopTimer = tick(elapsed, copy);
    img.addEventListener('load', function () { img.hidden = false; });
    loadPhoto(img, file, function () { return !stopped; });
    return {
      node: node,
      stop: function () {
        stopped = true;
        stopTimer();
      }
    };
  }

  L.scan.progress = { start: start };
})();
