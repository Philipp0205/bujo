/*
 * The what's-new entry on the settings page: a short section with a button that reopens the full list.
 * Needs ak-dom.js, boot.js and copy.js. The list opens in the plain settings look, not the paper look.
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var W = window.BujoWhatsNew = window.BujoWhatsNew || {};

  /** The settings section: a title, one line of hint, and the button that opens every entry. */
  function section() {
    var copy = W.copy.settings;
    var button = h('button', { type: 'button', class: 'ak-btn ak-btn-secondary', 'data-action': 'open-whats-new', onclick: function () {
      W.boot.showAll({ paper: false });
    } }, copy.button);
    return h('section', { class: 'bj-section', 'data-section': 'whats-new' },
      h('h2', { class: 'bj-group-title' }, copy.title),
      h('p', { class: 'bj-note' }, copy.hint),
      h('div', { class: 'bj-form' }, button));
  }

  W.settingsRow = { section: section };
})();
