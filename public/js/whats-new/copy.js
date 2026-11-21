/*
 * What's new copy: every string the person reads, in one place. Plain JS, no build step.
 * Logic and UI files take their words from here.
 */
(function () {
  'use strict';

  var W = window.BujoWhatsNew = window.BujoWhatsNew || {};

  W.copy = {
    heading: 'What\u2019s new',
    subUnseen: 'Since you last looked',
    subAll: 'Everything so far',
    done: 'Done',
    settings: {
      title: 'What\u2019s new',
      hint: 'The changes that came to bujo, newest first.',
      button: 'See what\u2019s new',
      empty: 'Nothing to show yet.'
    }
  };
})();
