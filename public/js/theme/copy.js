/*
 * Theme copy: every string of the theme picker, in one place. Plain JS, no build step.
 */
(function () {
  'use strict';

  var T = window.BujoTheme = window.BujoTheme || {};

  T.copy = {
    title: 'Theme',
    hint: 'System follows your phone. Light and Dark stay as you choose, on every page.',
    group: 'Theme',
    options: { system: 'System', light: 'Light', dark: 'Dark' }
  };
})();
