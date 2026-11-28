/*
 * The ink button: the main button of a sheet (Apply, Save, Done) drawn as a pen outline instead of a flat bar. The outline is an svg
 * used as a CSS mask on the button's ::before (--ink-mask), so the button keeps its own children: a label change (textContent) never
 * wipes the drawing. The seed is the button's action, so a redraw gives the same wobble. A ResizeObserver redraws at the new size.
 * Needs path.js. No animation.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.ink = L.ink || {};

  var SELECTOR = '.sheet-entry .ak-sheet-dock .ak-btn:not(.ak-btn-quiet)';
  var RADIUS = 10;
  var watcher = null;
  var docks = null;

  /** The svg text of a button outline for a size and a seed: black pen strokes, since a mask only reads their alpha. */
  function outlineSvg(w, h, seed) {
    var paths = L.ink.path.rect(w, h, seed, { radius: RADIUS, scale: 1.1 }).map(function (stroke) {
      return '<path d="' + stroke.d + '" fill="none" stroke="#000" stroke-width="' + stroke.width * 1.5 + '" stroke-linecap="round" stroke-linejoin="round" opacity="' + stroke.opacity + '"/>';
    });
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' + paths.join('') + '</svg>';
  }

  /** Draws one button at its measured size. A button that is not laid out yet (width or height under 8) is left for the observer. */
  function draw(button) {
    var box = button.getBoundingClientRect();
    var w = Math.round(box.width * 10) / 10;
    var h = Math.round(box.height * 10) / 10;
    if (w < 8 || h < 8) return;
    var seed = button.getAttribute('data-action') || button.getAttribute('data-testid') || 'ink-button';
    button.style.setProperty('--ink-mask', 'url("data:image/svg+xml,' + encodeURIComponent(outlineSvg(w, h, seed)) + '")');
    button.setAttribute('data-ink', 'drawn');
  }

  /** Redraws the buttons whose size changed. */
  function onResize(entries) {
    entries.forEach(function (entry) { draw(entry.target); });
  }

  /** Starts to watch a button the first time, and draws it. */
  function wear(button) {
    if (button.hasAttribute('data-ink')) return;
    button.setAttribute('data-ink', 'new');
    if (watcher) watcher.observe(button);
    draw(button);
  }

  /** Dresses every main sheet button under root. Safe to call again: a button already dressed is skipped. */
  function dress(root) {
    if (typeof ResizeObserver !== 'undefined' && !watcher) watcher = new ResizeObserver(onResize);
    Array.prototype.forEach.call(root.querySelectorAll(SELECTOR), wear);
    watchDocks(root);
  }

  /** A dock that gets its buttons after the sheet opened (the migration sheet fills its dock later) is dressed when they arrive. */
  function watchDocks(root) {
    if (typeof MutationObserver === 'undefined') return;
    if (!docks) docks = new MutationObserver(function (records) { records.forEach(function (record) { dress(record.target); }); });
    Array.prototype.forEach.call(root.querySelectorAll('.ak-sheet-dock'), function (dock) { docks.observe(dock, { childList: true }); });
  }

  L.ink.button = { dress: dress, outlineSvg: outlineSvg };
})();
