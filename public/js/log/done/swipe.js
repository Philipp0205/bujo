/*
 * Swipe right on a task or done row to flip it, like a tap on its bullet. A clear gesture only: far enough, mostly horizontal,
 * and not from the left screen edge (that is the phone's own Back). A vertical move is a scroll (the rows allow pan-y only), a
 * press that ends in a swipe never opens the row (its click is swallowed), and select mode and long presses are left alone.
 * Mouse and touch both work (pointer events). Needs days.js (hasDay) and the DOM.
 * options: root (the page node), active() true while the swipe may act, onSwipe(id) with the data-id of the row.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.done = L.done || {};

  var MIN_DX = 64;
  var DOMINANCE = 2;
  var EDGE_PX = 24;
  var SWALLOW_MS = 300;

  var options = null;
  var start = null;
  var swallowUntil = 0;

  /** The swipeable row under an event: a task or done row of a day or calendar card, never a month-task or future row, never the line in the edit sheet. */
  function rowOf(event) {
    var row = event.target.closest && event.target.closest('.paper-row');
    if (!row || !row.closest('.entry-card, .card-child')) return null;
    if (!L.days.hasDay(row.getAttribute('data-horizon'))) return null;
    var type = row.getAttribute('data-type');
    return type === 'task' || type === 'done' ? row : null;
  }

  /** A pointer went down on a swipeable row, away from the screen edge: the swipe may begin. Gesture split: a swipe that begins on a row is this
   * done gesture, one that begins anywhere else is a page turn (js/log/pages/turn.js). */
  function onDown(event) {
    start = null;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (event.clientX < EDGE_PX || !options.active()) return;
    var row = rowOf(event);
    if (row) start = { id: row.getAttribute('data-id'), x: event.clientX, y: event.clientY };
  }

  /** The pointer is up: a swipe right (far enough, at least twice as wide as tall) flips the row, and the click after it is eaten. */
  function onUp(event) {
    var began = start;
    start = null;
    if (!began || !options.active()) return;
    var dx = event.clientX - began.x;
    var dy = Math.abs(event.clientY - began.y);
    if (dx < MIN_DX || dx < DOMINANCE * dy) return;
    swallowUntil = Date.now() + SWALLOW_MS;
    options.onSwipe(began.id);
  }

  /** The browser took the touch (a vertical scroll): no swipe. */
  function onCancel() {
    start = null;
  }

  /** Eats the click that ends a swipe, so the row does not also open. */
  function onClick(event) {
    if (Date.now() > swallowUntil) return;
    swallowUntil = 0;
    if (!rowOf(event)) return;
    event.stopPropagation();
    event.preventDefault();
  }

  /** Starts watching the page. Call once. */
  function init(config) {
    options = config;
    config.root.addEventListener('pointerdown', onDown);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
    document.addEventListener('click', onClick, true);
  }

  L.done.swipe = { init: init };
})();
