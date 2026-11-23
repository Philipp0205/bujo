/*
 * The font picker on the settings page: one row per text face, each set in its own face.
 * A tap saves and applies the choice at once and only flips aria-pressed, so nothing re-renders.
 * Needs ak-dom.js, font/boot.js and font/copy.js.
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var F = window.BujoFont;

  /** Marks the pressed row and clears the rest. */
  function mark(list, choice) {
    Array.prototype.forEach.call(list.children, function (row) {
      var on = row.getAttribute('data-font') === choice;
      row.setAttribute('aria-pressed', on ? 'true' : 'false');
      row.classList.toggle('bj-font-on', on);
    });
  }

  /** One choice row: the face name and a sample line, both in that face. A tap saves and applies it. */
  function option(choice, list) {
    return h('button', { type: 'button', class: 'bj-font-opt', 'aria-pressed': 'false', 'data-font': choice, onclick: function () {
      mark(list(), F.choose(choice));
    } },
    h('span', { class: 'bj-font-name' }, F.copy.options[choice]),
    h('span', { class: 'bj-font-sample' }, F.copy.sample));
  }

  /** The settings section: a title, one line of hint and the list of faces. */
  function section() {
    var list = h('div', { class: 'bj-font-list', role: 'group', 'aria-label': F.copy.group });
    F.choices.forEach(function (choice) { list.appendChild(option(choice, function () { return list; })); });
    mark(list, F.read());
    return h('section', { class: 'bj-section', 'data-section': 'font' },
      h('h2', { class: 'bj-group-title' }, F.copy.title),
      h('div', { class: 'bj-card', 'data-card': 'font' },
        h('div', { class: 'bj-form' }, h('p', { class: 'bj-note' }, F.copy.hint), list)));
  }

  F.section = { section: section };
})();
