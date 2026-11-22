/*
 * The view switcher: "Future | Month | Daily" in a quiet row above the date row. The view on screen wears a pen underline (drawn by the
 * ink decorator). It builds nodes and calls back. Needs ak-dom.js and copy.js.
 * switcher(ctx): view ('future' | 'month' | 'daily'), locked (selecting or editing: the buttons are off), onPick(view).
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};
  L.horizon = L.horizon || {};

  var ORDER = ['future', 'month', 'daily'];

  /** One word of the row. The active one is pressed and underlined in ink; a tap on it does nothing. */
  function tab(name, ctx) {
    var on = ctx.view === name;
    return h('button', {
      class: 'view-tab', type: 'button', 'data-testid': 'view-' + name, 'aria-pressed': on ? 'true' : 'false',
      disabled: ctx.locked, onclick: function () { if (!on) ctx.onPick(name); }
    }, L.copy.horizon.views[name]);
  }

  /** The switcher row, as a group of three buttons. */
  function build(ctx) {
    return h('div', { class: 'view-switcher', role: 'group', 'aria-label': L.copy.horizon.switcherLabel, 'data-testid': 'view-switcher' },
      ORDER.map(function (name) { return tab(name, ctx); }));
  }

  L.horizon.switcher = { build: build };
})();
