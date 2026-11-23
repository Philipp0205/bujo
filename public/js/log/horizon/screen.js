/*
 * Render functions of the Month and Future views: the head row, and the bodies (a month's calendar page, a month's tasks page, three
 * month buckets of the Future Log). They build nodes and call back, they never fetch. Needs ak-dom.js, copy.js, dates.js, glyph.js,
 * view.js (cards and the add row) and horizon/model.js.
 * monthHead(ctx): month, atHome, locked, around { prev, next } (booleans), nav { turn(direction), home() }.
 * futureHead(ctx): locked, around { prev, next } (booleans), nav { turn(direction) }.
 * monthBody(ctx): entries, today, actions (as in view.js), month, part ('calendar' | 'tasks').
 * futureBody(ctx): entries, today, actions, page (0 or 1).
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};
  L.horizon = L.horizon || {};

  /** An arrow of the head row (prefix names its test id: month-prev, future-next). It is off at the ends and while selecting or typing. */
  function arrow(direction, ctx, prefix) {
    var next = direction === 'next';
    return h('button', {
      class: 'page-arrow', type: 'button', 'data-testid': prefix + (next ? '-next' : '-prev'),
      'aria-label': next ? L.copy.pages.next : L.copy.pages.prev,
      disabled: !ctx.around[direction] || ctx.locked,
      onclick: function () { ctx.nav.turn(direction); }
    }, L.glyph.use(next ? 'g-chev-right' : 'g-chev-left', { width: 20, height: 20, viewBox: '0 0 24 24' }));
  }

  /** The way back to this month's calendar, on every page but that one. */
  function jump(ctx) {
    if (ctx.atHome) return null;
    return h('button', {
      class: 'page-today-jump', type: 'button', 'data-testid': 'month-jump', 'aria-label': L.copy.horizon.thisMonthLabel,
      disabled: ctx.locked, onclick: ctx.nav.home
    }, L.copy.horizon.thisMonth);
  }

  /** The head of the Month view: the month as a plain heading (the days are on the page, so it is no button), the jump and the arrows. */
  function monthHead(ctx) {
    return h('div', { class: 'page-head', 'data-testid': 'page-head' },
      h('div', { class: 'page-title' },
        h('h2', { class: 'paper-day', 'data-testid': 'month-heading' }, h('span', { class: 'horizon-title' }, L.copy.horizon.monthName(ctx.month))),
        jump(ctx)),
      h('div', { class: 'page-nav' }, arrow('prev', ctx, 'month'), arrow('next', ctx, 'month')));
  }

  /** The head of the Future view: one quiet heading and the arrows between its two pages. */
  function futureHead(ctx) {
    return h('div', { class: 'page-head', 'data-testid': 'page-head' },
      h('div', { class: 'page-title' },
        h('h2', { class: 'paper-day', 'data-testid': 'future-heading' }, h('span', { class: 'horizon-title' }, L.copy.horizon.futureHeading))),
      h('div', { class: 'page-nav' }, arrow('prev', ctx, 'future'), arrow('next', ctx, 'future')));
  }

  /** The cards of a list of cards, as the daily page draws them. */
  function cards(list, ctx) {
    return list.map(function (card) { return L.view.entryCard(card, ctx.actions, ctx.today); });
  }

  /** A quiet line for a list that has nothing in it. */
  function empty(text) {
    return h('p', { class: 'horizon-empty' }, text);
  }

  /** The label of a calendar day: its number and weekday initial, like "1 M". */
  function dayLabel(date) {
    return h('span', { class: 'cal-label', 'data-testid': 'month-day-label' },
      h('span', { class: 'cal-num' }, L.copy.horizon.dayNumber(date)), ' ',
      h('span', { class: 'cal-initial' }, L.copy.horizon.dayInitial(date)));
  }

  /** One line of the calendar: the day on the left, its entries and the traces of moves beside it. An empty day is just its label and a ruled line. */
  function calendarDay(day, ctx) {
    return h('section', { class: 'cal-day', 'data-date': day.date },
      dayLabel(day.date),
      h('div', { class: 'cal-entries' }, cards(L.days.cardsOf(day.entries), ctx), L.view.traceList(day.traces)));
  }

  /** The calendar page of a month: every day of it, in order, empty ones too. */
  function calendarPage(ctx) {
    var days = L.horizon.model.monthDays(ctx.entries, ctx.month);
    return h('div', { class: 'month-calendar', 'data-testid': 'month-calendar' }, days.map(function (day) { return calendarDay(day, ctx); }));
  }

  /** The tasks page of a month: its month tasks (and the traces of moves out of them), then the add row (not while selecting). */
  function tasksPage(ctx) {
    return h('section', { class: 'horizon-section horizon-tasks', 'data-testid': 'month-tasks' },
      h('h3', { class: 'horizon-label' }, L.copy.horizon.monthTasks),
      cards(L.horizon.model.monthCards(ctx.entries, ctx.month), ctx),
      L.view.traceList(L.horizon.model.monthTraces(ctx.entries, ctx.month)),
      ctx.actions.select.on() ? null : L.view.addRow(ctx.actions.add));
  }

  /** The body of the Month view: the calendar page or the tasks page of the month on screen. */
  function monthBody(ctx) {
    return ctx.part === 'tasks' ? tasksPage(ctx) : calendarPage(ctx);
  }

  /** One month of the Future Log: its heading and its items and traces, or a quiet line when it has neither. A rule under it parts it from the next. */
  function bucket(item, ctx) {
    var any = item.cards.length > 0 || item.traces.length > 0;
    return h('section', { class: 'horizon-section horizon-bucket', 'data-month': item.month, 'data-testid': 'future-bucket' },
      h('h3', { class: 'horizon-label', 'data-testid': 'future-bucket-label' }, L.copy.horizon.monthName(item.month)),
      any ? [cards(item.cards, ctx), L.view.traceList(item.traces)] : empty(L.copy.horizon.bucketEmpty));
  }

  /** The body of the Future view: the three month buckets of the open page, then one add row at the end. */
  function futureBody(ctx) {
    var page = L.horizon.model.futurePages(ctx.entries, ctx.today)[ctx.page || 0];
    return [
      page.map(function (item) { return bucket(item, ctx); }),
      ctx.actions.select.on() ? null : L.view.addRow(ctx.actions.add)
    ];
  }

  L.horizon.screen = { monthHead: monthHead, futureHead: futureHead, monthBody: monthBody, futureBody: futureBody };
})();
