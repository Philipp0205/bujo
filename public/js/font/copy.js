/*
 * Font copy: every string of the font picker, in one place. Plain JS, no build step.
 */
(function () {
  'use strict';

  var F = window.BujoFont = window.BujoFont || {};

  F.copy = {
    title: 'Paper font',
    hint: 'The face of your titles, entries and day headings. Saved on this phone only.',
    group: 'Paper font',
    sample: 'Call the dentist, then water the plants',
    options: { newsreader: 'Newsreader', literata: 'Literata', 'source-serif': 'Source Serif', lora: 'Lora' }
  };
})();
