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
      gallery: 'Choose from gallery'
    },
    progress: {
      step: 'Reading your page\u2026',
      hint: 'This can take a little while.',
      /** The time since the photo was sent, as m:ss. */
      elapsed: function (seconds) {
        var rest = seconds % 60;
        return Math.floor(seconds / 60) + ':' + (rest < 10 ? '0' : '') + rest;
      }
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
      updatesEntry: 'updates entry',
      changedInApp: 'also changed in the app',
      was: 'was',
      noTag: 'no tag',
      noTime: 'no time',
      keep: 'Keep this line',
      drop: 'Skip this line',
      noLines: 'No lines were read from this page.',
      applying: 'Applying\u2026',
      unchanged: function (count, open) {
        return count + ' unchanged' + (open ? ', hide' : '');
      },
      /** The subtitle and the button say what will be written: new entries and updates, never the unchanged lines. */
      writes: function (counts) {
        var parts = [];
        if (counts.created) parts.push(counts.created + (counts.created === 1 ? ' new entry' : ' new entries'));
        if (counts.updated) parts.push(counts.updated + (counts.updated === 1 ? ' update' : ' updates'));
        return parts.length ? parts.join(', ') : 'nothing to write';
      },
      apply: function (counts) {
        var total = counts.created + counts.updated;
        if (total === 0) return 'Nothing to apply';
        if (!counts.updated) return 'Apply ' + counts.created + (counts.created === 1 ? ' entry' : ' entries');
        if (!counts.created) return 'Apply ' + counts.updated + (counts.updated === 1 ? ' update' : ' updates');
        return 'Apply ' + counts.created + ' new, ' + counts.updated + (counts.updated === 1 ? ' update' : ' updates');
      }
    }
  };
})();
