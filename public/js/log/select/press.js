/*
 * The long press on a log row: hold for about half a second without moving to start selecting. Mouse and touch both work
 * (pointer events). A press that moves more than a few pixels is a scroll or a drag, so it is dropped. The click that follows
 * a long press is swallowed, so letting go never opens the editor. Needs nothing but the DOM.
 * options: root (the page node), onHold(id) with the data-id of the pressed row.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.select = L.select || {};

  var HOLD_MS = 500;
  var SLOP_PX = 10;
  var SWALLOW_MS = 300;

  var root = null;
  var onHold = null;
  var press = null;
  var swallow = null;

  /** The log row under an event, or null. Only the rows of the cards count, never the line in the edit sheet. */
  function rowOf(event) {
    var row = event.target.closest && event.target.closest('.paper-row');
    return row && row.closest('.entry-card, .card-child') ? row : null;
  }

  /** Drops the press in progress. */
  function drop() {
    if (press) window.clearTimeout(press.timer);
    press = null;
  }

  /** The hold time passed without moving: the row is held. */
  function fire() {
    press.fired = true;
    onHold(press.id);
  }

  /** A pointer went down on a row: the hold clock starts. Only the main mouse button counts. A new press ends any swallow left over. */
  function onDown(event) {
    drop();
    swallow = null;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    var row = rowOf(event);
    if (!row) return;
    press = { id: row.getAttribute('data-id'), x: event.clientX, y: event.clientY, fired: false, timer: window.setTimeout(fire, HOLD_MS) };
  }

  /** Moving further than the slop before the hold time ends the press. */
  function onMove(event) {
    if (!press || press.fired) return;
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > SLOP_PX) drop();
  }

  /** The pointer is up (or the browser took the touch): after a hold, the click on the same row is swallowed for a moment. */
  function onEnd() {
    if (press && press.fired) swallow = { id: press.id, until: Date.now() + SWALLOW_MS };
    drop();
  }

  /** Eats the click that ends a long press, so the row does not also open or untick. Any click ends the swallow, only the pressed row's own is eaten. */
  function onClick(event) {
    var held = swallow;
    swallow = null;
    var row = held && rowOf(event);
    if (!row || Date.now() > held.until || row.getAttribute('data-id') !== held.id) return;
    event.stopPropagation();
    event.preventDefault();
  }

  /** A held finger on a row would open the browser's menu; the hold means select instead. */
  function onMenu(event) {
    if (rowOf(event)) event.preventDefault();
  }

  /** Starts watching the page. Call once. */
  function init(options) {
    root = options.root;
    onHold = options.onHold;
    root.addEventListener('pointerdown', onDown);
    root.addEventListener('contextmenu', onMenu);
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onEnd);
    document.addEventListener('pointercancel', onEnd);
    document.addEventListener('click', onClick, true);
  }

  L.select.press = { init: init };
})();
