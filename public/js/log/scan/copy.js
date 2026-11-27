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
      title: 'Align the page',
      shutter: 'Take a photo',
      gallery: 'Choose from gallery',
      /** The day row on the camera screen: the day to file on, and whether the person picked it (a picked day beats the date on the page). */
      day: function (heading) { return heading; },
      dayDefault: 'a date on the page wins',
      dayPicked: 'picked by you',
      dayLabel: 'Day to file on'
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
      noText: 'No text was read from this page.',
      /** The row above the form when the scan looks like a saved note (or is a rescan of one): update it, or save a copy. */
      matchGroup: 'Update or save as new',
      matchLooks: function (title, day) { return 'Looks like your note \u201c' + title + '\u201d from ' + day + '.'; },
      matchRescan: function (title, day) { return 'Scanning your note \u201c' + title + '\u201d from ' + day + ' again.'; },
      matchUpdate: 'Update it',
      matchNew: 'Save as new'
    },
    errors: {
      type: 'This file is not a JPEG, PNG, WebP or HEIC photo.',
      size: 'The photo is too large (at most 15 MB).',
      scanFailed: 'Could not read the page. Try again.',
      applyFailed: 'Could not save the entries. Try again.',
      titleRequired: 'Give every kept line a title.',
      dayRequired: function (title) { return 'Give \u201c' + title + '\u201d a day of this month.'; },
      dayMissing: function (title, day) { return 'Day ' + day + ' is not a day of this month. Fix \u201c' + title + '\u201d.'; },
      monthRequired: 'Give every kept line a month.',
      kindFailed: 'Could not switch the page kind. Try again.',
      paperInvalid: 'The notebook page must be a whole number from 1 to 9999, or empty.'
    },
    review: {
      title: 'Review scan',
      paperLabel: 'Notebook page',
      paperHint: 'read from the photo',
      date: 'Date',
      dateFromPage: 'Read from the page',
      dateFallback: 'Today, no date found',
      dateOpenDay: 'Open day, no date found',
      datePicked: 'Picked by you',
      dateContinues: function (day) { return 'Continues ' + day + ', no date on this page'; },
      useToday: 'Use today instead',
      kindGroup: 'Kind of page',
      typeGroup: 'Type of page',
      types: { log: 'Log page', note: 'Note or collection' },
      typeSource: {
        structure: 'Looks like a log page: it has a date or month heading',
        bullets: 'Looks like a log page: it has bullet lines',
        title: 'Looks like a note or collection: it starts with a title, not a date',
        plain: 'Looks like a note or collection: no log bullets found',
        rescan: 'Scanning a saved note again',
        picked: 'Type picked by you'
      },
      pageGroup: 'Page of the day',
      page: function (page) { return 'Page ' + page; },
      pageRescan: function (page) { return 'Rescan of page ' + page + ': its lines are matched, nothing is replaced.'; },
      pageNew: function (page) { return 'A new page: its lines are added after page ' + (page - 1) + '.'; },
      pageFirst: 'The first page of this day. Pick another page if it is not.',
      kinds: { daily: 'Daily', future: 'Future', calendar: 'Calendar', 'month-task': 'Month tasks' },
      kindSource: {
        llm: 'Kind read from the page',
        page: 'Kind read from the page',
        view: 'Kind from the open view',
        default: 'Kind assumed, please check',
        picked: 'Kind picked by you'
      },
      futureSubject: 'Future log',
      month: 'Month',
      monthCaption: 'Month of this page',
      monthLabel: function (month) {
        return L.copy.pages.picker.months[Number(month.slice(5, 7)) - 1] + ' ' + month.slice(0, 4);
      },
      dayLabel: 'Day',
      thisLine: 'this line',
      noMonth: 'No month yet',
      noDay: 'No day yet',
      type: 'Type',
      titleLabel: 'Title',
      tagLabel: 'Tag',
      tag: 'tag',
      checkSpelling: 'check spelling',
      changedInApp: 'also changed in the app',
      /** The quiet mark on a line dated before today, and its spoken form. Such a line starts unticked. */
      past: 'past',
      pastLabel: 'Date has passed, so this line starts unticked',
      important: 'important',
      was: 'was',
      noTag: 'no tag',
      noTime: 'no time',
      keep: 'Keep this line',
      keepLabel: 'Keep',
      /** The quiet switch that nests a line under the line above it (a note under a meeting). */
      nest: 'Nest under line above',
      unnest: 'Nested under line above',
      nestLabel: 'Nest this line under the line above',
      unnestLabel: 'Take this line out from under the line above',
      /** The faint line of a line that matched an entry of the day: it is that item, not a new one. */
      matches: function (title) {
        return 'matches: ' + title;
      },
      /** A ">" or "<" line that matched the trace a move left on this page: nothing to write. */
      matchesTrace: 'matches the trace of a moved entry',
      traceChange: 'already on paper, nothing to write',
      /** What applying does to the matched entry, by the kind of change the paper carries. */
      matchChange: {
        same: 'already matches, only marked on paper',
        done: 'will be marked done',
        migrated: 'will be marked migrated',
        scheduled: 'will be marked scheduled',
        dropped: 'will be marked dropped',
        task: 'will be set to a task',
        note: 'will be set to a note',
        event: 'will be set to an event',
        fields: 'will update the entry'
      },
      /** A matched line that was un-matched: it is a new entry, and the item it matched is left alone. */
      notMatched: function (title) {
        return 'new entry, not ' + (title ? title : 'the moved entry');
      },
      unmatch: 'Not the same',
      unmatchLabel: function (title) {
        return 'Treat as a new entry, not ' + (title ? title : 'the moved entry');
      },
      rematch: 'Match again',
      rematchLabel: 'Match this line to its entry again',
      noLines: 'No lines were read from this page.',
      applying: 'Applying\u2026',
      /** The faint line of a matched entry the paper puts in another place: a rescan moves it. */
      movesTo: function (position) { return 'moves to position ' + position; },
      /** The subtitle and the button say what will be written: new entries and updates, never the unchanged lines. Moved entries are named too. */
      writes: function (counts) {
        var parts = [];
        if (counts.created) parts.push(counts.created + (counts.created === 1 ? ' new entry' : ' new entries'));
        if (counts.updated) parts.push(counts.updated + (counts.updated === 1 ? ' update' : ' updates'));
        if (counts.moved) parts.push(counts.moved + ' moved');
        if (counts.confirmed) parts.push(counts.confirmed + ' marked on paper');
        return parts.length ? parts.join(', ') : 'nothing to write';
      },
      apply: function (counts) {
        var total = counts.created + counts.updated;
        if (total === 0 && counts.confirmed && !counts.moved) return 'Mark ' + counts.confirmed + ' on paper';
        if (total === 0) return counts.moved ? 'Apply new order' : 'Nothing to apply';
        if (!counts.updated) return 'Apply ' + counts.created + (counts.created === 1 ? ' entry' : ' entries');
        if (!counts.created) return 'Apply ' + counts.updated + (counts.updated === 1 ? ' update' : ' updates');
        return 'Apply ' + counts.created + ' new, ' + counts.updated + (counts.updated === 1 ? ' update' : ' updates');
      }
    }
  };
})();
