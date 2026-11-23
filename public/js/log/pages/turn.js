/*
 * The page turn by swipe: a swipe left shows the next page, a swipe right the previous one. A clear gesture only: far enough, mostly
 * horizontal, and not from the left screen edge (that is the phone's own Back). A vertical move is a scroll. A swipe that turns a page
 * eats the click that follows it, so it never also starts a line. Mouse and touch both work (pointer events). Needs only the DOM.
 * The split with the row swipe (js/log/move/swipe.js): a swipe that begins on a row is the row gesture, any other start is a page turn.
 * options: root (the page node), active() true while turning is allowed, onTurn('next' | 'prev').
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.pages = L.pages || {};

  var MIN_DX = 64;
  var DOMINANCE = 2;
  var EDGE_PX = 24;
  var SWALLOW_MS = 300;

  var options = null;
  var start = null;
  var swallowUntil = 0;

  /** A pointer went down off a row, away from the screen edge: a turn may begin. A row start belongs to the done swipe. */
  function onDown(event) {
    start = null;
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
    if (event.clientX < EDGE_PX || !options.active()) return;
    if (event.target.closest && event.target.closest('.paper-row')) return;
    start = { x: event.clientX, y: event.clientY };
  }

  /** The pointer is up: a swipe far enough and at least twice as wide as tall turns the page (left is next), and the click after it is eaten. */
  function onUp(event) {
    var began = start;
    start = null;
    if (!began || !options.active()) return;
    var dx = event.clientX - began.x;
    var dy = Math.abs(event.clientY - began.y);
    if (Math.abs(dx) < MIN_DX || Math.abs(dx) < DOMINANCE * dy) return;
    swallowUntil = Date.now() + SWALLOW_MS;
    options.onTurn(dx < 0 ? 'next' : 'prev');
  }

  /** The browser took the touch (a vertical scroll): no turn. */
  function onCancel() {
    start = null;
  }

  /** Eats the click that ends a turn, so the paper under it does not start a line. */
  function onClick(event) {
    if (Date.now() > swallowUntil) return;
    swallowUntil = 0;
    event.stopPropagation();
    event.preventDefault();
  }

  /** A new press ends the swallow: only the click that follows the swipe's own release is eaten, never a deliberate tap right after. */
  function onPress() {
    swallowUntil = 0;
  }

  /** Starts watching the page. Call once. */
  function init(config) {
    options = config;
    document.addEventListener('pointerdown', onPress, true);
    config.root.addEventListener('pointerdown', onDown);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
    document.addEventListener('click', onClick, true);
  }

  L.pages.turn = { init: init };
})();
