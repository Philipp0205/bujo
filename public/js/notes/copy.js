/*
 * Notes screen copy: every string the person reads on the Notes page, in one place. Plain JS, no build step.
 */
(function () {
  'use strict';

  var B = window.BujoNotes = window.BujoNotes || {};

  B.copy = {
    title: 'Notes',
    loading: 'Turning the page\u2026',
    loadFailed: 'Could not load your notes. Try again.',
    retry: 'Try again',
    empty: 'No notes yet. Write one, scan a page, or start a collection.',
    offlineEmpty: 'You\u2019re offline. Your notes show up here when you are back.',
    offlineHint: 'You\u2019re offline. These are your notes from the last visit.',
    noPhoto: 'No photo',
    openLabel: 'Open note'
  };
})();
