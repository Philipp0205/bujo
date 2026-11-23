/*
 * Collections screen copy: every string the person reads on the Collections page, in one place. Plain JS, no build step.
 */
(function () {
  'use strict';

  var B = window.BujoNotes = window.BujoNotes || {};

  B.copy = {
    title: 'Collections',
    loading: 'Turning the page\u2026',
    loadFailed: 'Could not load your collections. Try again.',
    retry: 'Try again',
    empty: 'No collections yet. Scan a page to start one.',
    offlineEmpty: 'You\u2019re offline. Your collections show up here when you are back.',
    offlineHint: 'You\u2019re offline. These are your collections from the last visit.',
    noPhoto: 'No photo',
    openLabel: 'Open collection'
  };
})();
