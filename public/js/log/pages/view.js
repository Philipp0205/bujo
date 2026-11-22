/*
 * Render functions of one daily page: the date row (heading, Today jump, arrows, page number), the scrolling body and the edge
 * turn targets. They build nodes and call back, they never fetch and know nothing of the state. Needs ak-dom.js, copy.js, dates.js,
 * glyph.js and view.js (the Today mark). The cards of the day come in as the body.
 * page(ctx): date, ready, isToday, number, around { prev, next }, locked (selecting or editing), turn ('next' | 'prev' | null), body (nodes),
 *            nav { turn(direction), pick(), home() }, switcher (the view switcher row, or nothing).
 * shell(ctx, key, headNode) is the same page around any head row: the Month and Future views use it with their own head.
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};
  L.pages = L.pages || {};

  /** An arrow of the date row. It is off at the end of the notebook and while selecting. */
  function arrow(direction, ctx) {
    var next = direction === 'next';
    var target = ctx.around[direction];
    return h('button', {
      class: 'page-arrow', type: 'button', 'data-testid': next ? 'page-next' : 'page-prev',
      'aria-label': next ? L.copy.pages.next : L.copy.pages.prev,
      disabled: !target || ctx.locked,
      onclick: function () { ctx.nav.turn(direction); }
    }, L.glyph.use(next ? 'g-chev-right' : 'g-chev-left', { width: 20, height: 20, viewBox: '0 0 24 24' }));
  }

  /** The page number, like the folio of a notebook. Empty while the pages are loading. */
  function folio(ctx) {
    var text = ctx.number ? String(ctx.number) : '';
    return h('span', { class: 'page-folio', 'data-testid': 'page-folio', role: 'img', 'aria-label': ctx.number ? L.copy.pages.folio(ctx.number) : null }, text);
  }

  /** The day heading is a button: it opens the day picker. The Today mark sits next to it on today. */
  function heading(ctx) {
    return h('h2', { class: 'paper-day', 'data-date': ctx.date },
      h('button', {
        class: 'page-date', type: 'button', 'data-testid': 'page-date', title: L.copy.pages.pickDay, 'aria-haspopup': 'dialog',
        disabled: !ctx.ready || ctx.locked, onclick: ctx.nav.pick
      }, L.dates.dayHeading(ctx.date)),
      ctx.isToday ? L.view.todayMark() : null);
  }

  /** The way back to today, on every page but today's. */
  function jump(ctx) {
    if (ctx.isToday) return null;
    return h('button', {
      class: 'page-today-jump', type: 'button', 'data-testid': 'today-jump', 'aria-label': L.copy.pages.toTodayLabel,
      disabled: !ctx.ready || ctx.locked, onclick: ctx.nav.home
    }, L.copy.pages.toToday);
  }

  /** The date row: heading and Today jump on the left, the arrows around the page number on the right. Room is left in it for a later switcher. */
  function head(ctx) {
    return h('div', { class: 'page-head', 'data-testid': 'page-head' },
      h('div', { class: 'page-title' }, heading(ctx), jump(ctx)),
      h('div', { class: 'page-nav' }, arrow('prev', ctx), folio(ctx), arrow('next', ctx)));
  }

  /** A strip along the side of the page that turns it with one tap. Only where a page lies that way, and never while selecting. */
  function edge(direction, ctx) {
    if (!ctx.around[direction] || ctx.locked) return null;
    return h('div', {
      class: 'page-edge page-edge-' + direction, 'data-testid': 'page-edge-' + direction, 'aria-hidden': 'true',
      onclick: function () { ctx.nav.turn(direction); }
    });
  }

  /** The leaf: the scrolling body and the two edge strips. The incoming leaf of a turn slides in (log pages.css). */
  function leaf(ctx, key) {
    return h('div', { class: 'page-leaf', 'data-turn': ctx.turn },
      h('div', { class: 'page-body', 'data-date': key, 'data-testid': 'page-body' }, ctx.body),
      edge('prev', ctx),
      edge('next', ctx));
  }

  /** The shell of every view: the switcher row, the head row, then the scrolling leaf. key is the day, the month or "future" (it lets a redraw keep the scroll). */
  function shell(ctx, key, headNode) {
    return h('div', { class: 'paper-page daily-page', 'data-date': key, 'data-view': ctx.view || 'daily', 'data-page': ctx.number ? String(ctx.number) : null },
      ctx.switcher || null, headNode, leaf(ctx, key));
  }

  /** One page of the notebook for a day. */
  function page(ctx) {
    return shell(ctx, ctx.date, head(ctx));
  }

  L.pages.view = { page: page, shell: shell };
})();
