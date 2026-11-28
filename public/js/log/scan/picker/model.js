/*
 * Pure model of the page type picker on top of the scan review: Log or Collection, then Daily, Monthly or Future (or list, tracker, project,
 * misc), then where the page goes (a page number, a month, a range of months). No DOM. The words come from scan/copy.js.
 * Needs log/copy.js, dates.js, pages/model.js, scan/copy.js and scan/model.js. A page is { type: 'log' | 'note', noteKind, state }
 * (see scan/flow.js); a log page's state is the review state of scan/model.js.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.scan = L.scan || {};

  var SUBS = { log: ['daily', 'monthly', 'future'], collection: ['list', 'tracker', 'project', 'misc'] };
  var DEFAULT_NOTE_KIND = 'misc';
  var MONTHLY_KINDS = ['calendar', 'month-task'];
  var RANGE_MONTHS = 3;
  var RANGE_CHOICES = 4;
  var MONTH_CHOICES_BACK = 1;
  var MONTH_CHOICES = 14;

  function copy() { return L.copy.scan.picker; }

  /** 'log' or 'collection': a page saved as a note is a collection. */
  function typeOf(page) {
    return page.type === 'note' ? 'collection' : 'log';
  }

  /** The step 2 value of a page kind: calendar and month-task pages are both Monthly. */
  function subOfKind(kind) {
    return kind === 'daily' || kind === 'future' ? kind : 'monthly';
  }

  /** The step 2 value of a page: its log kind, or the collection kind it is saved with (misc until one is picked). */
  function subOf(page) {
    return typeOf(page) === 'collection' ? (page.noteKind || DEFAULT_NOTE_KIND) : subOfKind(page.state.kind);
  }

  /** The page kind a log sub step files as. Monthly keeps a monthly kind the page already has, else the detected one, else the calendar. */
  function kindOfSub(sub, state) {
    if (sub !== 'monthly') return sub;
    if (MONTHLY_KINDS.indexOf(state.kind) >= 0) return state.kind;
    return MONTHLY_KINDS.indexOf(state.detectedKind) >= 0 ? state.detectedKind : 'calendar';
  }

  /** The full name of a month (YYYY-MM). */
  function monthName(month) {
    return L.copy.pages.picker.months[Number(month.slice(5, 7)) - 1];
  }

  /** The label of a month: its name, with the year when it is not this year. */
  function monthLabel(month) {
    return copy().month(monthName(month), month.slice(0, 4), L.dates.todayIso().slice(0, 4));
  }

  /** The first month (YYYY-MM) of the calendar quarter a month is in: the window the Future step offers. */
  function quarterStart(month) {
    var number = Number(month.slice(5, 7));
    var first = number - ((number - 1) % RANGE_MONTHS);
    return month.slice(0, 5) + (first < 10 ? '0' : '') + first;
  }

  /** The months of the future lines that have one, oldest first. */
  function lineMonths(state) {
    return state.items.map(function (item) { return item.month; }).filter(Boolean).sort();
  }

  /** The first month of the future range: the chosen one, else the first month a line holds, else this quarter. */
  function rangeFrom(state) {
    if (state.rangeFrom) return state.rangeFrom;
    var months = lineMonths(state);
    return months.length ? months[0] : quarterStart(L.pages.model.monthOf(L.dates.todayIso()));
  }

  /** The last month of the future range: three months from a chosen start, else the last month a line holds. */
  function rangeTo(state) {
    var months = lineMonths(state);
    if (state.rangeFrom || !months.length) return L.pages.model.shiftMonth(rangeFrom(state), RANGE_MONTHS - 1);
    return months[months.length - 1];
  }

  /** The label of a range of months, as short names ("Jan - Mar"). */
  function rangeLabel(from, to) {
    return copy().range(monthName(from).slice(0, 3), monthName(to).slice(0, 3));
  }

  /** The target step of a log page as { value, label }: the page of a day, the month, or the range of months. */
  function targetOf(state) {
    var sub = subOfKind(state.kind);
    if (sub === 'daily') return { value: state.page, label: copy().page(state.page) };
    if (sub === 'monthly') return { value: state.month, label: monthLabel(state.month) };
    return { value: state.rangeFrom, label: rangeLabel(rangeFrom(state), rangeTo(state)) };
  }

  /** The step 4 value of a monthly page: its calendar (days down the page) or its tasks (work and private). */
  function partOf(state) {
    return state.kind === 'calendar' ? 'calendar' : 'tasks';
  }

  /** The page kind a part of the month files as. */
  function kindOfPart(part) {
    return part === 'calendar' ? 'calendar' : 'month-task';
  }

  /** The steps to draw for a page: [{ step, value, label }], the target only for a log page, and the part of the month only for a monthly one. */
  function steps(page) {
    var type = typeOf(page);
    var sub = subOf(page);
    var list = [{ step: 'type', value: type, label: copy().type[type] }, { step: 'sub', value: sub, label: copy().sub[sub] }];
    if (type === 'log') list.push(Object.assign({ step: 'target' }, targetOf(page.state)));
    if (type === 'log' && sub === 'monthly') list.push({ step: 'part', value: partOf(page.state), label: copy().part[partOf(page.state)] });
    return list;
  }

  /** The line between step 1 and step 2: an arrow for a log, a short branch for a collection. */
  function linkOf(page) {
    return typeOf(page) === 'collection' ? 'branch' : 'arrow';
  }

  /** The months the Monthly step offers: last month and the year ahead, plus the month the page holds. */
  function monthValues(state) {
    var first = L.pages.model.shiftMonth(L.pages.model.monthOf(L.dates.todayIso()), -MONTH_CHOICES_BACK);
    var months = [];
    for (var step = 0; step < MONTH_CHOICES; step += 1) months.push(L.pages.model.shiftMonth(first, step));
    if (months.indexOf(state.month) < 0) months.push(state.month);
    return months.sort();
  }

  /** The windows of three months the Future step offers: this quarter and the next ones. */
  function rangeValues() {
    var first = quarterStart(L.pages.model.monthOf(L.dates.todayIso()));
    var windows = [];
    for (var step = 0; step < RANGE_CHOICES; step += 1) windows.push(L.pages.model.shiftMonth(first, step * RANGE_MONTHS));
    return windows;
  }

  /** The choices of the target step: [{ value, label }]. */
  function targetChoices(state) {
    var sub = subOfKind(state.kind);
    if (sub === 'daily') {
      return L.scan.model.pageOptions(state).map(function (option) { return { value: option.page, label: copy().page(option.page) }; });
    }
    if (sub === 'monthly') return monthValues(state).map(function (month) { return { value: month, label: monthLabel(month) }; });
    return rangeValues().map(function (from) { return { value: from, label: rangeLabel(from, L.pages.model.shiftMonth(from, RANGE_MONTHS - 1)) }; });
  }

  /** The options a step opens with, [{ value, label, selected }]. */
  function options(step, page) {
    var current = steps(page).filter(function (entry) { return entry.step === step; })[0];
    var list;
    if (step === 'type') list = ['log', 'collection'].map(function (value) { return { value: value, label: copy().type[value] }; });
    else if (step === 'sub') list = SUBS[typeOf(page)].map(function (value) { return { value: value, label: copy().sub[value] }; });
    else if (step === 'part') list = ['calendar', 'tasks'].map(function (value) { return { value: value, label: copy().part[value] }; });
    else list = targetChoices(page.state);
    return list.map(function (option) { return { value: option.value, label: option.label, selected: current.value === option.value }; });
  }

  /** Files the lines of a future page that have no month on the first month of the chosen range, and remembers the range for its label. */
  function setRange(state, from) {
    state.rangeFrom = from;
    state.items.forEach(function (item) { if (!item.month) item.month = from; });
  }

  /** Sets the target of a log page: its physical page (daily), its month (monthly) or its range of months (future). */
  function setTarget(state, value) {
    var sub = subOfKind(state.kind);
    if (sub === 'daily') L.scan.model.setPage(state, value);
    else if (sub === 'monthly') L.scan.model.setMonth(state, value);
    else setRange(state, value);
  }

  L.scan.picker = L.scan.picker || {};
  L.scan.picker.model = {
    typeOf: typeOf, subOf: subOf, kindOfSub: kindOfSub, kindOfPart: kindOfPart, steps: steps, linkOf: linkOf, options: options, setTarget: setTarget
  };
})();
