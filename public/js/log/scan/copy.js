/*
 * Scan copy: every string of the scan screen and the review sheet. Adds L.copy.scan to the log copy.
 * Needs log/copy.js and dates.js. Logic and view files take their words from here.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};

  L.copy.scan = {
    camera: {
      close: 'Close',
      title: 'Align the rapid log page',
      titleNote: 'Align the note page',
      modes: 'What to scan',
      rapid: 'Rapid log',
      note: 'Free note',
      shutter: 'Take a photo',
      gallery: 'Choose from gallery',
      busy: 'Reading the page\u2026'
    },
    note: {
      reviewHeading: 'Free note',
      reviewSub: 'Scanned just now',
      save: 'Save note',
      cancel: 'Cancel',
      noText: 'No text was read from this page.'
    },
    errors: {
      type: 'This file is not a JPEG, PNG, WebP or HEIC photo.',
      size: 'The photo is too large (at most 15 MB).',
      scanFailed: 'Could not read the page. Try again.',
      applyFailed: 'Could not save the entries. Try again.',
      titleRequired: 'Give every kept line a title.'
    },
    review: {
      title: 'Review scan',
      date: 'Date',
      dateFromPage: 'Read from the page',
      dateFallback: 'Today, no date found',
      datePicked: 'Picked by you',
      type: 'Type',
      titleLabel: 'Title',
      tagLabel: 'Tag',
      tag: 'tag',
      checkSpelling: 'check spelling',
      duplicate: 'already in log',
      marksDone: 'marks done',
      keep: 'Keep this line',
      drop: 'Skip this line',
      noLines: 'No lines were read from this page.',
      applying: 'Applying\u2026',
      entries: function (count) {
        return count + (count === 1 ? ' entry' : ' entries');
      },
      apply: function (count) {
        return 'Apply ' + count + (count === 1 ? ' entry' : ' entries');
      }
    }
  };
})();
