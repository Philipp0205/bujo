/*
 * Render functions of the Month and Future views: the head row, and the bodies (days with entries and the month tasks; six month
 * buckets). They build nodes and call back, they never fetch. Needs ak-dom.js, copy.js, dates.js, glyph.js, view.js (cards and the add
 * row) and horizon/model.js.
 * monthHead(ctx): month, isThisMonth, locked, around { prev, next } (months or null), nav { turn(direction), home() }.
 * futureHead(): the heading of the Future Log.
 * monthBody(ctx) and futureBody(ctx): entries, today, actions (as in view.js), month (monthBody only).
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};
  L.horizon = L.horizon || {};

  /** An arrow of the month row. It is off at the end of the six months and while selecting or typing. */
  function arrow(direction, ctx) {
    var next = direction === 'next';
    return h('button', {
      class: 'page-arrow', type: 'button', 'data-testid': next ? 'month-next' : 'month-prev',
      'aria-label': next ? L.copy.horizon.nextMonth : L.copy.horizon.prevMonth,
      disabled: !ctx.around[direction] || ctx.locked,
      onclick: function () { ctx.nav.turn(direction); }
    }, L.glyph.use(next ? 'g-chev-right' : 'g-chev-left', { width: 20, height: 20, viewBox: '0 0 24 24' }));
  }

  /** The way back to this month, on every month but this one. */
  function jump(ctx) {
    if (ctx.isThisMonth) return null;
    return h('button', {
      class: 'page-today-jump', type: 'button', 'data-testid': 'month-jump', 'aria-label': L.copy.horizon.thisMonthLabel,
      disabled: ctx.locked, onclick: ctx.nav.home
    }, L.copy.horizon.thisMonth);
  }

  /** The head of the Month view: the month as a plain heading (the days are in the log, so it is no button), the jump and the arrows. */
  function monthHead(ctx) {
    return h('div', { class: 'page-head', 'data-testid': 'page-head' },
      h('div', { class: 'page-title' },
        h('h2', { class: 'paper-day', 'data-testid': 'month-heading' }, h('span', { class: 'horizon-title' }, L.copy.horizon.monthName(ctx.month))),
        jump(ctx)),
      h('div', { class: 'page-nav' }, arrow('prev', ctx), arrow('next', ctx)));
  }

  /** The head of the Future view: one quiet heading, no arrows. */
  function futureHead() {
    return h('div', { class: 'page-head', 'data-testid': 'page-head' },
      h('div', { class: 'page-title' },
        h('h2', { class: 'paper-day', 'data-testid': 'future-heading' }, h('span', { class: 'horizon-title' }, L.copy.horizon.futureHeading))));
  }

  /** The cards of a list of cards, as the daily page draws them. */
  function cards(list, ctx) {
    return list.map(function (card) { return L.view.entryCard(card, ctx.actions, ctx.today); });
  }

  /** A quiet line for a list that has nothing in it. */
  function empty(text, testid) {
    return h('p', { class: 'horizon-empty', 'data-testid': testid }, text);
  }

  /** One day with entries: its heading, then its cards. */
  function dayBlock(day, ctx) {
    return h('section', { class: 'horizon-section horizon-day', 'data-date': day.date },
      h('h3', { class: 'horizon-label', 'data-testid': 'month-day-label' }, L.dates.dayHeading(day.date)),
      cards(L.days.cardsOf(day.entries), ctx));
  }

  /** The body of the Month view: the days that have entries, then the month tasks and the add row (not while selecting). */
  function monthBody(ctx) {
    var days = L.horizon.model.monthDays(ctx.entries, ctx.month);
    var tasks = L.horizon.model.monthCards(ctx.entries, ctx.month);
    return [
      days.length ? days.map(function (day) { return dayBlock(day, ctx); }) : empty(L.copy.horizon.noDays, 'month-no-days'),
      h('section', { class: 'horizon-section horizon-tasks', 'data-testid': 'month-tasks' },
        h('h3', { class: 'horizon-label' }, L.copy.horizon.monthTasks),
        cards(tasks, ctx),
        ctx.actions.select.on() ? null : L.view.addRow(ctx.actions.add))
    ];
  }

  /** One month of the Future Log: its heading and its items, or a quiet line when it has none. */
  function bucket(item, ctx) {
    return h('section', { class: 'horizon-section horizon-bucket', 'data-month': item.month, 'data-testid': 'future-bucket' },
      h('h3', { class: 'horizon-label', 'data-testid': 'future-bucket-label' }, L.copy.horizon.monthName(item.month)),
      item.cards.length ? cards(item.cards, ctx) : empty(L.copy.horizon.bucketEmpty, null));
  }

  /** The body of the Future view: six month buckets, then one add row at the end. */
  function futureBody(ctx) {
    return [
      L.horizon.model.buckets(ctx.entries, ctx.today).map(function (item) { return bucket(item, ctx); }),
      ctx.actions.select.on() ? null : L.view.addRow(ctx.actions.add)
    ];
  }

  L.horizon.screen = { monthHead: monthHead, futureHead: futureHead, monthBody: monthBody, futureBody: futureBody };
})();
