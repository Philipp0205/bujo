/*
 * The reorder drag of the daily log: the row (a card with the entries nested under it, or one nested entry) is lifted like a slip of paper,
 * follows the pointer, the rows it passes make room, and a dashed scribble marks where it will land. Let go to drop it there. The rows
 * never leave the DOM during the drag: they only get a transform, so nothing re-lays out and the pointer keeps its row.
 * Where a card may land: among the cards of its own paper page (the pages are fixed by the paper); a nested entry among the entries nested
 * under the same card. Only the Daily log's days drag. Near the top or bottom edge the sheet scrolls by itself.
 * A redraw of the page that is asked for during a drag waits until the drag ends (see defer).
 * Driven by gesture/hold.js, which decides when a press becomes a drag. Needs the DOM and done/flip.js (buzz).
 * init options: root (the scrolling page node), onDrop(slot, ids) with slot { date, horizon } and ids the entries that moved, in their new order.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.gesture = L.gesture || {};

  var EDGE_PX = 72;
  var SCROLL_MAX = 14;
  var TILT = 'rotate(-0.7deg)';

  var options = null;
  var d = null;
  var parked = null;

  /** The paper page a card sits on, as the text of its first row's data-page ('' for one not on paper). */
  function pageOf(unit) {
    var row = unit.querySelector('.paper-row');
    return (row && row.getAttribute('data-page')) || '';
  }

  /** The units a unit may trade places with: the cards of its page, or the entries nested under the same card. */
  function siblingsOf(unit) {
    var children = Array.prototype.slice.call(unit.parentElement.children);
    if (unit.classList.contains('card-child')) return children.filter(function (el) { return el.classList.contains('card-child'); });
    var page = pageOf(unit);
    return children.filter(function (el) { return el.classList.contains('entry-card') && pageOf(el) === page; });
  }

  /** The ids of the entries a unit holds, top to bottom (a card: the entry then those nested under it). */
  function idsOf(unit) {
    return Array.prototype.map.call(unit.querySelectorAll('.paper-row[data-id]'), function (row) { return row.getAttribute('data-id'); });
  }

  /** Where each sibling sits now, in the coordinates of the scrolled sheet (so a scroll during the drag does not change them). */
  function measure(siblings) {
    var scroll = options.root.scrollTop;
    return siblings.map(function (el) {
      var box = el.getBoundingClientRect();
      return { top: box.top + scroll, height: box.height, left: box.left, width: box.width };
    });
  }

  /** The hand-drawn dashed slot where the lifted row will land. It is absolutely placed in the parent, behind the rows. */
  function makeSlot(parent, first) {
    var slot = document.createElement('div');
    slot.className = 'drag-slot';
    slot.setAttribute('aria-hidden', 'true');
    slot.setAttribute('data-testid', 'drag-slot');
    var box = parent.getBoundingClientRect();
    slot.style.left = first.left - box.left + 'px';
    slot.style.width = first.width + 'px';
    slot.style.height = first.height + 'px';
    parent.appendChild(slot);
    return slot;
  }

  /** How far the lifted row has moved: the pointer's move plus what the sheet scrolled since the press. */
  function offset() {
    return (d.lastY - d.startY) + (options.root.scrollTop - d.startScroll);
  }

  /** The place the lifted row would take now: how many of the other rows lie above its middle. */
  function indexAt(dy) {
    var middle = d.boxes[d.from].top + d.boxes[d.from].height / 2 + dy;
    return d.boxes.filter(function (box, at) { return at !== d.from && box.top + box.height / 2 < middle; }).length;
  }

  /** The vertical shift of a row that makes room: up by the lifted height when the row passed over it, down when the row came from below. */
  function shiftOf(at, to) {
    var height = d.boxes[d.from].height;
    if (to > d.from && at > d.from && at <= to) return -height;
    if (to < d.from && at >= to && at < d.from) return height;
    return 0;
  }

  /** The top of the landing slot, in the sheet's coordinates. */
  function slotTop(to) {
    var box = d.boxes[to];
    if (to > d.from) return box.top + box.height - d.boxes[d.from].height;
    return box.top;
  }

  /** Lays the drag out for the pointer's place: the lifted row under the finger, the others making room, the slot where it will land. */
  function layout() {
    var dy = offset();
    d.unit.style.transform = 'translateY(' + dy + 'px) ' + TILT;
    d.to = indexAt(dy);
    d.siblings.forEach(function (el, at) {
      if (at !== d.from) el.style.transform = shiftOf(at, d.to) ? 'translateY(' + shiftOf(at, d.to) + 'px)' : '';
    });
    d.slot.style.top = slotTop(d.to) - d.parentTop + 'px';
  }

  /** While the pointer rests near the top or bottom edge of the sheet, scrolls it and keeps the drag in step. */
  function autoScroll() {
    if (!d) return;
    var box = options.root.getBoundingClientRect();
    var speed = 0;
    if (d.lastY < box.top + EDGE_PX) speed = -SCROLL_MAX * Math.min(1, (box.top + EDGE_PX - d.lastY) / EDGE_PX);
    else if (d.lastY > box.bottom - EDGE_PX) speed = SCROLL_MAX * Math.min(1, (d.lastY - (box.bottom - EDGE_PX)) / EDGE_PX);
    if (speed) {
      options.root.scrollTop += speed;
      layout();
    }
    d.frame = window.requestAnimationFrame(autoScroll);
  }

  /** The lifted look and the setup of the drag for a unit. */
  function lift(unit, siblings, event) {
    var boxes = measure(siblings);
    var from = siblings.indexOf(unit);
    var parent = unit.parentElement;
    var parentBox = parent.getBoundingClientRect();
    d = {
      unit: unit, siblings: siblings, boxes: boxes, from: from, to: from, parent: parent, startY: event.clientY, lastY: event.clientY,
      startScroll: options.root.scrollTop, parentTop: parentBox.top + options.root.scrollTop, frame: 0,
      ownPosition: parent.style.position, slot: makeSlot(parent, boxes[from])
    };
    if (window.getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
    siblings.forEach(function (el) { if (el !== unit) el.classList.add('drag-sibling'); });
    unit.classList.add('is-lifted');
    options.root.classList.add('is-dragging');
    layout();
    L.done.flip.buzz();
    d.frame = window.requestAnimationFrame(autoScroll);
  }

  /** Takes the drag away: the looks, the slot and the loop go; a redraw that waited runs now. */
  function cleanup() {
    window.cancelAnimationFrame(d.frame);
    d.siblings.forEach(function (el) { el.classList.remove('drag-sibling', 'is-lifted'); el.style.transform = ''; });
    d.slot.remove();
    d.parent.style.position = d.ownPosition;
    options.root.classList.remove('is-dragging');
    d = null;
    var redraw = parked;
    parked = null;
    if (redraw) redraw();
  }

  /** The press became a drag. False when this row cannot be reordered (not a day entry, or nothing to trade places with). */
  function start(row, event) {
    var group = row.closest('.paper-day-group');
    var unit = row.closest('.card-child') || row.closest('.entry-card');
    if (!group || !unit || row.getAttribute('data-horizon') !== 'day') return false;
    var siblings = siblingsOf(unit);
    if (siblings.length < 2) return false;
    lift(unit, siblings, event);
    d.slotDate = group.getAttribute('data-date');
    return true;
  }

  /** The pointer moved: the lifted row follows. */
  function move(event) {
    if (!d) return;
    d.lastY = event.clientY;
    layout();
  }

  /** The pointer is up: the row lands where the slot is. A drop on its own place changes nothing. */
  function end(event) {
    if (!d) return;
    d.lastY = event.clientY;
    layout();
    var moved = d.to !== d.from;
    var order = d.siblings.filter(function (el) { return el !== d.unit; });
    order.splice(d.to, 0, d.unit);
    var ids = order.reduce(function (all, el) { return all.concat(idsOf(el)); }, []);
    var slot = { date: d.slotDate, horizon: 'day' };
    cleanup();
    if (moved) options.onDrop(slot, ids);
  }

  /** The drag is called off (Escape, or the browser took the touch): everything goes back. */
  function cancel() {
    if (d) cleanup();
  }

  /** True while a row is being dragged. */
  function active() {
    return d !== null;
  }

  /** Parks a redraw while a drag runs: true when fn was kept (it runs once the drag ends), false when no drag runs and the caller goes on. */
  function defer(fn) {
    if (!d) return false;
    parked = fn;
    return true;
  }

  /** Wires the drag to its page. Call once. */
  function init(config) {
    options = config;
  }

  L.gesture.drag = { init: init, start: start, move: move, end: end, cancel: cancel, active: active, defer: defer };
})();
