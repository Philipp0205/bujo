/*
 * The long press on the marker (the bullet) of a log row: hold for about half a second without moving to open the type picker.
 * A short tap is left alone (the done toggle still flips a task). A move past the slop before the hold time is a swipe or a scroll, not
 * a hold. It stays off the left screen edge (the phone's Back). The click that ends a hold is eaten, so the row does not also toggle or
 * open. The row long press of the planet menu (radial/hold.js) skips a press this owns (see owns). Needs days.js (hasDay) and the DOM.
 * options: root (the page node), active() true while a hold may act, onHold(id) with the data-id of the row. Each page that shows
 * rows (the log, a collection page) calls init with its own root; a press is handled by the page whose root holds it.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.type = L.type || {};

  var HOLD_MS = 500;
  var SLOP_PX = 10;
  var EDGE_PX = 24;
  var SWALLOW_MS = 300;

  var pages = [];
  var press = null;
  var swallowUntil = 0;
  var listening = false;

  /** The page (as wired by init) whose root holds the event's target, or undefined. */
  function pageOf(event) {
    return pages.filter(function (page) { return page.root.contains(event.target); })[0];
  }

  /** The row whose marker is under an event: a row of a day or calendar card with an id. Null for traces, month-task and future rows. */
  function rowOf(event) {
    var mark = event.target.closest && event.target.closest('.paper-sym');
    var row = mark && mark.closest('.paper-row');
    if (!row || !row.getAttribute('data-id') || row.getAttribute('data-type') === 'dropped' || !row.closest('.entry-card, .card-child')) return null;
    return L.days.hasDay(row.getAttribute('data-horizon')) ? row : null;
  }

  /** True when a press belongs to the marker hold (not to the row hold of select mode). */
  function owns(event) {
    var page = pageOf(event);
    return !!page && page.active() && event.clientX >= EDGE_PX && rowOf(event) !== null;
  }

  /** Drops the press in progress and its look. */
  function drop() {
    if (!press) return;
    window.clearTimeout(press.timer);
    press.mark.classList.remove('is-holding');
    press = null;
  }

  /** The hold time passed without moving: the picker opens. */
  function fire() {
    press.fired = true;
    press.page.onHold(press.id);
  }

  /** A pointer went down on a marker: the hold clock starts and the marker shows the ink wash. */
  function onDown(event) {
    drop();
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0) || !owns(event)) return;
    var mark = event.target.closest('.paper-sym');
    mark.classList.add('is-holding');
    press = { page: pageOf(event), id: rowOf(event).getAttribute('data-id'), mark: mark, x: event.clientX, y: event.clientY, fired: false, timer: window.setTimeout(fire, HOLD_MS) };
  }

  /** Moving further than the slop before the hold time ends the press. */
  function onMove(event) {
    if (!press || press.fired) return;
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > SLOP_PX) drop();
  }

  /** The pointer is up (or the browser took the touch): after a hold, the click that follows is swallowed for a moment. */
  function onEnd() {
    if (press && press.fired) swallowUntil = Date.now() + SWALLOW_MS;
    drop();
  }

  /** Eats the click that ends a hold, so the row does not also toggle or open, and the picker is not closed by it. */
  function onClick(event) {
    if (Date.now() > swallowUntil) return;
    swallowUntil = 0;
    event.stopPropagation();
    event.preventDefault();
  }

  /** Starts watching a page. Call once per page. The document listeners are added with the first page. */
  function init(config) {
    pages.push(config);
    config.root.addEventListener('pointerdown', onDown);
    if (listening) return;
    listening = true;
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onEnd);
    document.addEventListener('pointercancel', onEnd);
    document.addEventListener('click', onClick, true);
  }

  L.type.hold = { init: init, owns: owns };
})();
