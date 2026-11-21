/*
 * The theme picker on the settings page: three buttons (System, Light, Dark) in one card.
 * A tap saves and applies the choice at once and only flips aria-pressed, so nothing re-renders.
 * Needs ak-dom.js, theme/boot.js and theme/copy.js.
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var T = window.BujoTheme;

  /** Marks the pressed button and clears the rest. */
  function mark(group, choice) {
    Array.prototype.forEach.call(group.children, function (button) {
      var on = button.getAttribute('data-theme') === choice;
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
      button.classList.toggle('ak-on', on);
    });
  }

  /** One choice button. Its tap saves and applies the theme, then updates the group in place. */
  function option(choice, group) {
    return h('button', { type: 'button', class: 'ak-segment-btn', 'aria-pressed': 'false', 'data-theme': choice, onclick: function () {
      mark(group(), T.choose(choice));
    } }, T.copy.options[choice]);
  }

  /** The settings section: a title, one line of hint and the three-way choice. */
  function section() {
    var group = h('div', { class: 'ak-segment bj-theme', role: 'group', 'aria-label': T.copy.group });
    T.choices.forEach(function (choice) { group.appendChild(option(choice, function () { return group; })); });
    mark(group, T.read());
    return h('section', { class: 'bj-section', 'data-section': 'theme' },
      h('h2', { class: 'bj-group-title' }, T.copy.title),
      h('div', { class: 'bj-card', 'data-card': 'theme' },
        h('div', { class: 'bj-form' }, h('p', { class: 'bj-note' }, T.copy.hint), group)));
  }

  T.section = { section: section };
})();
