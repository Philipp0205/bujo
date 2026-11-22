/*
 * The day picker: a compact paper calendar in a popover under the date row. Days with entries carry a dot, the page on screen is
 * circled, and one tap on a day with entries (or today) turns to it and closes the picker. An empty day cannot be chosen.
 * Escape and the phone's Back close it (BujoNav.overlays, name "picker"). The month arrows read only that month from the log's own
 * API (never the whole journal) and never go past what the log can load around today.
 * Needs ak-dom.js, copy.js, dates.js, pages/model.js, api.js and nav/overlays.js.
 * open(options): anchor (the node it hangs under), date (the page on screen), today, marks ({ date: true }), loaded ({ from, to }, the
 * days already in the log), onPick(date).
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};
  L.pages = L.pages || {};

  var GAP = 4;
  var layer = null;
  var panel = null;
  var picker = null;

  /** True while the picker is on screen. */
  function isOpen() {
    return layer !== null;
  }

  /** The month shown in the title, like "November 2026". */
  function monthTitle(month) {
    return L.copy.pages.picker.months[Number(month.slice(5, 7)) - 1] + ' ' + month.slice(0, 4);
  }

  /** A small month arrow. It is off when no day of that month can be loaded. */
  function monthArrow(step) {
    var target = L.pages.model.shiftMonth(picker.month, step);
    var back = step < 0;
    return h('button', {
      class: 'picker-arrow', type: 'button', 'data-testid': back ? 'picker-prev' : 'picker-next',
      'aria-label': back ? L.copy.pages.picker.prevMonth : L.copy.pages.picker.nextMonth,
      disabled: !L.pages.model.monthReaches(target, picker.today),
      onclick: function () { showMonth(target); }
    }, L.glyph.use(back ? 'g-chev-left' : 'g-chev-right', { width: 18, height: 18, viewBox: '0 0 24 24' }));
  }

  /** The month title between its two arrows. */
  function monthHead() {
    return h('div', { class: 'picker-head' },
      monthArrow(-1),
      h('div', { class: 'picker-month', 'data-testid': 'picker-month', 'aria-live': 'polite' }, monthTitle(picker.month)),
      monthArrow(1));
  }

  /** The words a screen reader gets for a day: its heading, and that it has entries. */
  function dayLabel(date) {
    return L.dates.dayHeading(date) + (picker.marks[date] ? ', ' + L.copy.pages.picker.hasEntries : '');
  }

  /** One day of the grid. Only today and days with entries can be chosen. */
  function dayCell(date) {
    var can = L.pages.model.pickable(date, picker.marks, picker.today);
    return h('button', {
      class: 'picker-day', type: 'button', 'data-date': date, 'data-testid': 'picker-day',
      'data-marked': picker.marks[date] ? 'true' : null, 'data-today': date === picker.today ? 'true' : null,
      'data-selected': date === picker.date ? 'true' : null, 'aria-current': date === picker.date ? 'date' : null,
      'aria-label': dayLabel(date), disabled: !can,
      onclick: function () { choose(date); }
    }, String(Number(date.slice(8, 10))));
  }

  /** The weekday letters and the weeks of the month, Monday first. */
  function grid() {
    var names = L.copy.pages.picker.weekdays.map(function (name) { return h('span', { class: 'picker-weekday', 'aria-hidden': 'true' }, name); });
    var weeks = L.pages.model.monthWeeks(picker.month).map(function (week) {
      return week.map(function (date) { return date ? dayCell(date) : h('span', { class: 'picker-blank', 'aria-hidden': 'true' }); });
    });
    return h('div', { class: 'picker-grid' }, names, weeks);
  }

  /** Draws the panel for the month on show. */
  function paint() {
    if (panel) panel.replaceChildren(monthHead(), grid());
  }

  /** Reads the days of a month that the log has not loaded yet, so their dots show. A failed read leaves them plain (and unchosen). */
  function fetchMarks(month) {
    var range = L.pages.model.monthRange(month);
    var reach = L.dates.reachable(picker.today);
    var from = range.from < reach.from ? reach.from : range.from;
    var to = range.to > reach.to ? reach.to : range.to;
    if (from > to || picker.fetched[month] || (L.pages.model.within(picker.loaded, from) && L.pages.model.within(picker.loaded, to))) return;
    picker.fetched[month] = true;
    L.api.list(from, to).then(function (entries) {
      if (!picker) return;
      Object.assign(picker.marks, L.pages.model.marksOf(entries));
      paint();
    }, function () { picker.fetched[month] = false; });
  }

  /** Shows another month. */
  function showMonth(month) {
    picker.month = month;
    paint();
    fetchMarks(month);
  }

  /** A day was tapped: the picker closes first (its Back entry goes), then the page turns. */
  function choose(date) {
    var pick = picker.onPick;
    close();
    pick(date);
  }

  /** Escape closes the picker before anything else sees the key. */
  function onKey(event) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    close();
  }

  /** Puts the focus back on the date button when the picker closes. */
  function returnFocus() {
    var button = document.querySelector('[data-testid="page-date"]');
    if (button && !button.disabled) button.focus({ preventScroll: true });
  }

  /** Closes the picker and gives its Back layer up. Closing twice is harmless. */
  function close() {
    if (!layer) return;
    document.removeEventListener('keydown', onKey, true);
    layer.remove();
    layer = null;
    panel = null;
    picker = null;
    BujoNav.overlays.release('picker');
    returnFocus();
  }

  /** Builds the layer: a see-through scrim that closes on a tap, and the panel under the date row. */
  function build(anchor) {
    panel = h('div', { class: 'day-picker', role: 'dialog', 'aria-label': L.copy.pages.picker.label, 'data-testid': 'day-picker' });
    panel.style.top = Math.round(anchor.getBoundingClientRect().bottom + GAP) + 'px';
    layer = h('div', { class: 'picker-layer' }, h('div', { class: 'picker-scrim', onclick: close }), panel);
    document.body.appendChild(layer);
  }

  /** Puts the focus on the page on screen (or on the first day that can be chosen), so the keyboard works at once. */
  function focusDay() {
    var mine = panel.querySelector('.picker-day[data-selected="true"]:not(:disabled)') || panel.querySelector('.picker-day:not(:disabled)');
    if (mine) mine.focus({ preventScroll: true });
  }

  /** Opens the picker on the month of the page on screen. */
  function open(options) {
    if (layer) return;
    picker = {
      date: options.date, today: options.today, month: L.pages.model.monthOf(options.date), marks: Object.assign({}, options.marks),
      loaded: options.loaded, onPick: options.onPick, fetched: {}
    };
    build(options.anchor);
    paint();
    BujoNav.overlays.open('picker', close);
    document.addEventListener('keydown', onKey, true);
    fetchMarks(picker.month);
    focusDay();
  }

  L.pages.picker = { open: open, close: close, isOpen: isOpen };
})();
