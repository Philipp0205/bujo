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
    empty: 'No notes yet. Scan a page or add a note from the log.',
    noPhoto: 'No photo',
    openLabel: 'Open note'
  };
})();
