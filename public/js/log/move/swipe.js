/*
 * Swipe an open task row to move it: right is migrate (>), left is schedule (<). While the finger is down and the move has locked as
 * sideways, the row follows it and the mark shows in the gap. A release past the threshold calls onSwipe(id, kind), a release short of it
 * snaps the row back. A vertical move is a scroll (rows allow pan-y only, so the browser ends the pointer with pointercancel). Stays off the
 * left screen edge (the phone's own Back). The click that ends a swipe is eaten, so the row does not also open. Mouse and touch both work.
 * The split with the page turn (js/log/pages/turn.js): a swipe that begins on an open task row is this gesture, any other start turns the page.
 * Needs days.js (hasDay), glyph.js, move/model.js (KINDS), done/flip.js (buzz) and the DOM.
 * options: root (the page node), active() true while the swipe may act, onSwipe(id, kind).
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.move = L.move || {};

  var MIN_DX = 64;
  var DOMINANCE = 2;
  var LOCK_PX = 12;
  var MAX_PULL = 96;
  var EDGE_PX = 24;
  var SWALLOW_MS = 300;

  var options = null;
  var start = null;
  var swallowUntil = 0;

  /** The swipeable row under an event: an open task of a day or calendar card, never a done, note, event, month-task or future row. */
  function rowOf(event) {
    var row = event.target.closest && event.target.closest('.paper-row');
    if (!row || !row.closest('.entry-card, .card-child')) return null;
    if (!L.days.hasDay(row.getAttribute('data-horizon'))) return null;
    return row.getAttribute('data-type') === 'task' ? row : null;
  }

  /** The kind a sideways distance asks for: right migrates, left schedules. */
  function kindOf(dx) {
    return dx > 0 ? 'migrate' : 'schedule';
  }

  /** True when a move is clearly sideways: far enough and at least twice as wide as tall. */
  function sideways(dx, dy, min) {
    return Math.abs(dx) >= min && Math.abs(dx) >= DOMINANCE * Math.abs(dy);
  }

  /** The mark in the gap under the row, the glyph of the type the swipe asks for. */
  function inkOf(kind) {
    var ink = document.createElement('span');
    ink.className = 'swipe-ink swipe-ink-' + kind;
    ink.setAttribute('aria-hidden', 'true');
    ink.appendChild(L.glyph.typeGlyph(L.move.model.KINDS[kind]));
    return ink;
  }

  /**
 * The row follows the finger (up to MAX_PULL) and the mark in the gap sharpens once the threshold is passed. The row narrows instead of sliding,
 * so its text re-wraps inside the screen and a long title is never pushed off the edge.
 */
  function pull(dx) {
    var shown = Math.max(-MAX_PULL, Math.min(MAX_PULL, dx));
    var kind = kindOf(dx);
    if (start.kind !== kind) {
      if (start.ink) start.ink.remove();
      start.ink = inkOf(kind);
      start.row.appendChild(start.ink);
      start.kind = kind;
    }
    var gap = Math.abs(shown);
    start.row.style.width = 'calc(100% - ' + gap + 'px)';
    start.row.style.marginLeft = shown > 0 ? shown + 'px' : '';
    start.ink.classList.toggle('is-ready', Math.abs(dx) >= MIN_DX);
  }

  /** Puts the row back where it was and takes the mark away. */
  function settle() {
    if (!start || !start.locked) return;
    start.row.classList.add('is-snapping');
    start.row.style.width = '';
    start.row.style.marginLeft = '';
    if (start.ink) start.ink.remove();
    var row = start.row;
    window.setTimeout(function () { row.classList.remove('is-snapping'); }, 200);
  }

  /** A pointer went down on an open task, away from the screen edge: the swipe may begin. */
  function onDown(event) {
    start = null;
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
    if (event.clientX < EDGE_PX || !options.active()) return;
    var row = rowOf(event);
    if (row) start = { row: row, id: row.getAttribute('data-id'), x: event.clientX, y: event.clientY, locked: false, kind: null, ink: null };
  }

  /** The pointer moved: once clearly sideways the swipe locks (with a pulse) and the row follows; it then stays locked until release. */
  function onMove(event) {
    if (!start) return;
    var dx = event.clientX - start.x;
    var dy = event.clientY - start.y;
    if (!start.locked && sideways(dx, dy, LOCK_PX)) {
      start.locked = true;
      L.done.flip.buzz();
    }
    if (start.locked) pull(dx);
  }

  /** The pointer is up: a swipe past the threshold asks for a move, anything less snaps back. Any locked swipe eats the click after it. */
  function onUp(event) {
    var began = start;
    if (!began) return;
    settle();
    start = null;
    var dx = event.clientX - began.x;
    if (began.locked) swallowUntil = Date.now() + SWALLOW_MS;
    if (!began.locked || !options.active() || !sideways(dx, event.clientY - began.y, MIN_DX)) return;
    options.onSwipe(began.id, kindOf(dx));
  }

  /** The browser took the touch (a vertical scroll): no swipe, the row goes back. */
  function onCancel() {
    settle();
    start = null;
  }

  /** Eats the click that ends a swipe, so the row does not also open. */
  function onClick(event) {
    if (Date.now() > swallowUntil) return;
    swallowUntil = 0;
    event.stopPropagation();
    event.preventDefault();
  }

  /** Starts watching the page. Call once. */
  function init(config) {
    options = config;
    config.root.addEventListener('pointerdown', onDown);
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
    document.addEventListener('click', onClick, true);
  }

  L.move.swipe = { init: init };
})();
