/*
 * Copy of the sound and haptics setting: every string, in one place. Plain JS, no build step.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.feel = L.feel || {};

  L.feel.copy = {
    title: 'Feedback',
    hint: 'A soft pen tick and a small buzz when you check off a task or turn a page. Off by default. Saved on this phone only.',
    label: 'Sound and haptics'
  };
})();
