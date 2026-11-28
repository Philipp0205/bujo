/*
 * The sound and haptics switch on the settings page: one row with a label and a pen tick box, a real switch (role=switch, aria-checked).
 * A tap or Space or Enter saves and flips it in place, so nothing re-renders. Needs ak-dom.js, ink/path.js, ink/tick.js, feel/model.js,
 * feel/store.js and feel/copy.js.
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};
  L.feel = L.feel || {};

  /** Shows the switch as on or off. */
  function show(button, on) {
    button.setAttribute('aria-checked', on ? 'true' : 'false');
  }

  /** The switch button: a native button, so the keyboard works, with the tick box that shows while it is on. */
  function control() {
    var button = h('button', { type: 'button', class: 'bj-switch', role: 'switch', 'data-testid': 'feel-switch', onclick: function () {
      show(button, L.feel.store.write(!L.feel.store.read()));
    } },
    h('span', { class: 'bj-switch-label' }, L.feel.copy.label),
    L.ink.tick.box('feel-switch'));
    show(button, L.feel.store.read());
    return button;
  }

  /** The settings section: a title, one line of hint and the switch. */
  function section() {
    return h('section', { class: 'bj-section', 'data-section': 'feel' },
      h('h2', { class: 'bj-group-title' }, L.feel.copy.title),
      h('div', { class: 'bj-card', 'data-card': 'feel' },
        h('div', { class: 'bj-form' }, h('p', { class: 'bj-note' }, L.feel.copy.hint), control())));
  }

  L.feel.section = { section: section };
})();
