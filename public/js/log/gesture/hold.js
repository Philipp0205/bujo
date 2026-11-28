/*
 * The one owner of a press on a log row. It runs the pointer state machine  pressed -> held -> dragging  (or  held -> still):
 *   pressed   the finger or mouse is down on a row. A move past the slop now is a scroll or the row swipe (move/swipe.js): the press is dropped.
 *   held      after HELD_MS the row is held (the page stops scrolling under a touch). A move past the slop from here starts a drag.
 *   dragging  the row is being dragged: the pointer moves go to the drag (gesture/drag.js) until the pointer is up.
 *   still     after STILL_MS without a move the row is held still: every onHeldStill subscriber is called. No drag follows.
 * Mouse and touch both work (pointer events). The click that ends a drag or a held-still press is eaten, so letting go never opens
 * the editor. A held finger would open the browser's menu on a row, so contextmenu on a row is cancelled.
 *
 * HOOK FOR OTHER FEATURES: L.gesture.hold.onHeldStill(fn). fn(id, row) runs once per press when a row is held still (about half a second,
 * no move). radial/hold.js (the planet menu, or a tick while already selecting) is the subscriber.
 *
 * Needs days.js (hasDay) and the DOM. init options: root (the page node), skip(event) true for a press that is not this one's
 * (the marker hold of type/hold.js), canDrag() true while a drag may start, drag { start(row, event) -> boolean, move(event), end(event), cancel() }.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.gesture = L.gesture || {};

  var HELD_MS = 280;
  var STILL_MS = 500;
  var SLOP_PX = 10;
  var SWALLOW_MS = 300;

  var options = null;
  var press = null;
  var swallow = null;
  var stillFns = [];

  /** The log row of a day or calendar day under an event, or null. Only the rows of the day cards count: month-task and future rows do not hold, and never the line in the edit sheet. */
  function rowOf(event) {
    var row = event.target.closest && event.target.closest('.paper-row');
    return row && row.getAttribute('data-id') && row.closest('.entry-card, .card-child') && L.days.hasDay(row.getAttribute('data-horizon')) ? row : null;
  }

  /** Drops the press in progress and its look. */
  function drop() {
    if (!press) return;
    window.clearTimeout(press.heldTimer);
    window.clearTimeout(press.stillTimer);
    if (press.row) press.row.classList.remove('is-grabbed');
    press = null;
  }

  /** The hold time passed without moving: the row is held, and a move from now on is a drag (when one may start). */
  function onHeld() {
    press.phase = 'held';
    if (options.canDrag()) press.row.classList.add('is-grabbed');
  }

  /** The still time passed without a move: the row is held still, so the subscribers hear of it. */
  function onStill() {
    if (press.phase !== 'held') return;
    press.phase = 'still';
    var id = press.id;
    var row = press.row;
    row.classList.remove('is-grabbed');
    stillFns.slice().forEach(function (fn) { fn(id, row); });
  }

  /** A pointer went down on a row: the clocks start. Only the main mouse button and the first finger count. A new press ends any swallow left over. */
  function onDown(event) {
    drop();
    swallow = null;
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
    var row = rowOf(event);
    if (!row || (options.skip && options.skip(event))) return;
    press = {
      id: row.getAttribute('data-id'), row: row, x: event.clientX, y: event.clientY, phase: 'pressed',
      heldTimer: window.setTimeout(onHeld, HELD_MS), stillTimer: window.setTimeout(onStill, STILL_MS)
    };
  }

  /** Begins the drag when the drag module takes it; a refusal (nothing to reorder here) ends the press. */
  function beginDrag(event) {
    if (options.canDrag() && options.drag.start(press.row, event)) {
      press.phase = 'dragging';
      window.clearTimeout(press.stillTimer);
      return;
    }
    drop();
  }

  /** Moving past the slop: before the hold it ends the press (a scroll or swipe), once held it starts the drag. While dragging the drag follows. */
  function onMove(event) {
    if (!press || !event.isPrimary) return;
    if (press.phase === 'dragging') { options.drag.move(event); return; }
    if (press.phase === 'still') return;
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) <= SLOP_PX) return;
    if (press.phase === 'held') beginDrag(event);
    else drop();
  }

  /** A held press owns the touch: the page must not scroll under the dragging finger. Needs a non-passive listener. */
  function onTouchMove(event) {
    if (press && (press.phase === 'held' || press.phase === 'dragging') && event.cancelable) event.preventDefault();
  }

  /** The pointer is up (or the browser took the touch): a drag ends (a cancel puts the row back), and the click after a drag or a still hold is eaten. */
  function onEnd(event) {
    if (!press) return;
    var ended = press;
    drop();
    if (ended.phase === 'dragging') {
      swallow = { id: null, until: Date.now() + SWALLOW_MS };
      if (event.type === 'pointercancel') options.drag.cancel(); else options.drag.end(event);
    } else if (ended.phase === 'still') {
      swallow = { id: ended.id, until: Date.now() + SWALLOW_MS };
    }
  }

  /** Escape puts a dragged row back. */
  function onKey(event) {
    if (event.key !== 'Escape' || !press || press.phase !== 'dragging') return;
    drop();
    options.drag.cancel();
  }

  /** Eats the click that ends a drag or a still hold, so the row does not also open or untick. Any click ends the swallow; after a still hold only the pressed row's own is eaten. */
  function onClick(event) {
    var held = swallow;
    swallow = null;
    if (!held || Date.now() > held.until) return;
    var row = rowOf(event);
    if (held.id !== null && (!row || row.getAttribute('data-id') !== held.id)) return;
    event.stopPropagation();
    event.preventDefault();
  }

  /** A held finger on a row would open the browser's menu; a hold means something else here. */
  function onMenu(event) {
    if (rowOf(event)) event.preventDefault();
  }

  /** Calls fn(id, row) whenever a row is held still. The hook for the planet menu (radial/hold.js). */
  function onHeldStill(fn) {
    stillFns.push(fn);
  }

  /** True while a row is held for a drag (or being dragged): the row swipe stands aside then, so a sideways move is part of the drag. */
  function holding() {
    return !!press && (press.phase === 'held' || press.phase === 'dragging');
  }

  /** Starts watching the page. Call once. */
  function init(config) {
    options = config;
    config.root.addEventListener('pointerdown', onDown);
    config.root.addEventListener('contextmenu', onMenu);
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onEnd);
    document.addEventListener('pointercancel', onEnd);
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick, true);
  }

  L.gesture.hold = { init: init, onHeldStill: onHeldStill, holding: holding };
})();
