/*
 * Notes screen copy: every string the person reads on the notes of a notebook (the grid and the quiet states), in one place. Plain JS, no build step.
 */
(function () {
  'use strict';

  var B = window.BujoNotes = window.BujoNotes || {};

  B.copy = {
    loading: 'Turning the page\u2026',
    loadFailed: 'Could not load your notes. Try again.',
    retry: 'Try again',
    offlineEmpty: 'You\u2019re offline. Your notebooks show up here when you are back.',
    offlineHint: 'You\u2019re offline. This is what you saw on the last visit.',
    noPhoto: 'No photo',
    openLabel: 'Open note'
  };
})();
