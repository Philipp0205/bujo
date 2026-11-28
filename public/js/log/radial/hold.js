/*
 * The long press on a log row: hold still for about half a second to open the planet menu (radial/view.js). The press itself is owned by
 * gesture/hold.js (it tells a held-still row from a scroll, a swipe and a drag, and eats the click after a long press, so letting go never
 * opens the editor). This file only subscribes to that hook (L.gesture.hold.onHeldStill). While select mode is on, a hold ticks one more
 * row and opens no menu. Letting go on a bubble (press, drag, release) runs it; letting go in place leaves the menu open to tap a bubble;
 * letting go after a drag onto nothing closes it. The click that ends the opening press is eaten (it can land on the veil, because the
 * veil appears under a still-down finger). A later tap on the veil, Escape and the phone's Back close it too (name "radial" in
 * BujoNav.overlays). Needs days.js, the radial modules, move/pick.js, feel/feedback.js, gesture/hold.js, nav/overlays.js and the DOM.
 * options: selecting() true while select mode is on, hooks { open(entry), select(id) } for the actions that live in the page.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.radial = L.radial || {};

  var SLOP_PX = 10;
  var LAYER = 'radial';

  var options = null;
  var shown = null;
  var grip = null;
  var eatOpenClick = false;

  /** Closes the menu and gives its Back layer back. Also what Back itself calls. */
  function close() {
    L.radial.view.close();
    shown = null;
    grip = null;
    eatOpenClick = false;
    BujoNav.overlays.release(LAYER);
  }

  /** A bubble was picked: the menu closes, a tick is felt, then the action runs. */
  function pick(key) {
    if (!shown) return;
    var id = shown;
    close();
    L.feel.feedback.cue('lock');
    L.radial.run(key, id, options.hooks);
  }

  /** The menu for an entry opens around the pressed row. */
  function show(entry, row) {
    var box = row.getBoundingClientRect();
    shown = entry.id;
    grip = { x: null, y: null, dragged: false };
    eatOpenClick = true;
    L.feel.feedback.cue('lock');
    L.radial.view.open({
      title: entry.title, type: entry.type, actions: L.radial.model.actionsFor(entry),
      at: { x: box.left + box.width / 2, y: box.top + box.height / 2 },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      onPick: pick, onClose: close
    });
    BujoNav.overlays.open(LAYER, close);
  }

  /** A row was held still: in select mode the row is ticked, otherwise the menu opens. */
  function onStill(id, row) {
    if (options.selecting()) { options.hooks.select(id); return; }
    var entry = L.move.pick.entryOf(id);
    if (entry) show(entry, row);
  }

  /** After the menu is open, a finger dragging over the ring lights the bubble under it. */
  function onMove(event) {
    if (!grip || !L.radial.view.isOpen()) return;
    if (grip.x == null) { grip.x = event.clientX; grip.y = event.clientY; }
    if (Math.hypot(event.clientX - grip.x, event.clientY - grip.y) > SLOP_PX) grip.dragged = true;
    L.radial.view.hot(L.radial.view.keyAt(event.clientX, event.clientY));
  }

  /** The pointer is up after the menu opened: after a drag, a bubble under it is picked and nothing under it closes the menu. A release in place leaves the menu open to tap a bubble. */
  function onEnd(event) {
    if (!grip || !L.radial.view.isOpen()) return;
    eatOpenClick = true;
    var dragged = grip.dragged;
    L.radial.view.hot(null);
    if (!dragged || event.type !== 'pointerup') { grip = null; return; }
    var key = L.radial.view.keyAt(event.clientX, event.clientY);
    if (key) pick(key);
    else close();
  }

  /** A new press after the opening finger is up is a real tap: do not eat the click that follows. */
  function onDown() {
    if (!grip) eatOpenClick = false;
  }

  /** Eats only the leftover click of the opening press (it can land on the veil, because the veil appears under a still-down finger). A later tap is left alone, so a bubble can run and a tap on the veil can close. */
  function onClick(event) {
    if (!shown || !eatOpenClick) return;
    eatOpenClick = false;
    event.stopPropagation();
    event.preventDefault();
  }

  /** Starts listening for held-still rows. Call once. */
  function init(config) {
    options = config;
    L.gesture.hold.onHeldStill(onStill);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onEnd);
    document.addEventListener('pointercancel', onEnd);
    document.addEventListener('click', onClick, true);
  }

  L.radial.hold = { init: init };
})();
