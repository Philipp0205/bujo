/*
 * Scan copy: every string of the scan screen and the review sheet. Adds L.copy.scan to the log copy.
 * Needs log/copy.js and dates.js. Logic and view files take their words from here.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};

  var wasMark = { task: '\u2022', note: '\u2013', event: 'o', done: 'x', migrated: '>', scheduled: '<', dropped: '~' };

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
      dayLabel: 'Day to file on',
      /** The quiet line under the buttons: how the pages add up. The shutter adds a page each tap, the gallery starts a batch of its own when nothing is taken yet, else its photos join the pages taken. */
      galleryHint: function (max) { return 'Take up to ' + max + ' pages, then tap Done. Gallery photos join them.'; },
      /** At the max: the shutter is off. */
      maxHint: function (max) { return 'That is ' + max + ' pages, the most one scan holds. Tap Done to read them.'; },
      /** The counter over the thumbnails. */
      count: function (count, max) { return count + ' of ' + max + ' pages'; },
      done: 'Done',
      stripLabel: 'Pages taken',
      remove: function (number) { return 'Remove page ' + number; }
    },
    progress: {
      step: 'Reading your page\u2026',
      /** The step line of a batch: which page is being read now. */
      page: function (number, total) { return 'Reading page ' + number + ' of ' + total + '\u2026'; },
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
      tooMany: function (max) { return 'Pick at most ' + max + ' pages at once.'; },
      scanFailed: 'Couldn\u2019t read the page right now. Try again.',
      applyFailed: 'Could not save the entries. Try again.',
      titleRequired: 'Give every kept line a title.',
      dayRequired: function (title) { return 'Give \u201c' + title + '\u201d a day of this month.'; },
      dayMissing: function (title, day) { return 'Day ' + day + ' is not a day of this month. Fix \u201c' + title + '\u201d.'; },
      monthRequired: 'Give every kept line a month.',
      kindFailed: 'Could not switch the page kind. Try again.',
      paperInvalid: 'The notebook page must be a whole number from 1 to 9999, or empty.'
    },
    /** The steps of a batch of pages: the header, the dots and the sheet of a page that is not up for review. */
    batch: {
      heading: function (number, total) { return 'Page ' + number + ' of ' + total; },
      group: 'Pages of this scan',
      prev: 'Previous page',
      next: 'Next page',
      skip: 'Skip this page',
      /** The spoken name of a page dot. */
      dot: function (number, status) { return 'Page ' + number + ', ' + status; },
      status: { pending: 'to review', applied: 'applied', saved: 'saved', skipped: 'skipped', failed: 'not read' },
      statusSub: function (status) { return { applied: 'Applied', saved: 'Saved', skipped: 'Skipped', failed: 'Not read' }[status]; },
      text: {
        applied: 'This page is applied to your log.',
        saved: 'This page is saved as a note.',
        skipped: 'You skipped this page. Nothing was saved.'
      },
      retry: 'Retry',
      retrying: 'Reading\u2026',
      reviewAgain: 'Review this page'
    },
    /** The type picker on top of the review: Log or Collection, then Daily, Monthly or Future (or a collection kind), then the target. */
    picker: {
      group: 'Type of page',
      steps: { type: 'Type of page', sub: 'Kind of page', target: 'Where it goes', part: 'Page of the month' },
      options: { type: 'Choose the type of page', sub: 'Choose the kind of page', target: 'Choose where the page goes', part: 'Choose the page of the month' },
      type: { log: 'Log', collection: 'Collection' },
      sub: { daily: 'Daily', monthly: 'Monthly', future: 'Future', list: 'list', tracker: 'tracker', project: 'project', misc: 'misc' },
      /** The page of a month: the calendar (days down the page) or the tasks (work and private). */
      part: { calendar: 'calendar', tasks: 'tasks' },
      page: function (page) { return 'Page ' + page; },
      /** A month in the Monthly step: the name, with the year when it is not this year. */
      month: function (name, year, thisYear) { return year === thisYear ? name : name + ' ' + year; },
      /** The range of the Future step, as short month names: "Jan - Mar". One month reads as itself. */
      range: function (from, to) { return from === to ? from : from + ' - ' + to; }
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
      pageRescan: function (page) { return 'Rescan of page ' + page + ': its lines are matched, nothing is replaced.'; },
      pageNew: function (page) { return 'A new page: its lines are added after page ' + (page - 1) + '.'; },
      pageFirst: 'The first page of this day. Pick another page if it is not.',
      futureSubject: 'Future log',
      month: 'Month',
      monthLabel: function (month) {
        return L.copy.pages.picker.months[Number(month.slice(5, 7)) - 1] + ' ' + month.slice(0, 4);
      },
      dayLabel: 'Day',
      thisLine: 'this line',
      noMonth: 'No month yet',
      /** The work or private toggle of a month-task line. */
      section: { group: 'Section', work: 'Work', private: 'Private' },
      noDay: 'No day yet',
      type: 'Type',
      titleLabel: 'Title',
      /** The legend under the header and the spoken state of each row: the pill colour never carries the meaning alone. */
      legend: {
        group: 'What the colours mean',
        matched: 'Matched',
        new: 'New',
        updated: 'Updated',
        skipped: 'Skipped',
        typeChanged: 'Type changed'
      },
      marker: {
        matched: 'Matched, unchanged on paper',
        new: 'New, will create an entry',
        updated: 'Updated, will change the entry',
        skipped: 'Skipped, will not be applied',
        typeChanged: ', type changes'
      },
      hardToRead: 'hard to read, check the text',
      changedInApp: 'also changed in the app',
      /** The quiet mark on a line dated before today, and its spoken form. Such a line starts unticked. */
      past: 'past',
      pastLabel: 'Date has passed, so this line starts unticked',
      important: 'important',
      keep: 'Keep this line',
      keepLabel: 'Keep',
      /** The one note under a row. Its parts are joined with commas. It never shows the OCR confidence. */
      matches: 'matches',
      /** The old state of a matched entry, only when its text differs: its bullet, its title, and what the paper turns it into. */
      was: function (type, title, change) {
        return 'was ' + (wasMark[type] ? wasMark[type] + ' ' : '') + title + (change ? ' \u2192 ' + change : '');
      },
      /** The typed form of each bullet, for the old state. */
      wasMark: wasMark,
      /** What the paper turns the entry into, after the arrow of the old state. Empty when it stays as it is. */
      changeTo: { same: '', done: 'done', migrated: 'migrated', scheduled: 'scheduled', dropped: 'dropped', task: 'task', note: 'note', event: 'event', fields: 'updated' },
      timeWas: function (time) { return 'time was ' + (time || 'none'); },
      /** A ">" or "<" line that matched the trace a move left on this page: nothing to write. */
      traceChange: 'already on paper',
      /** A task line that is an open task of an earlier day written again: applying moves that task here, no copy. date is YYYY-MM-DD. */
      movedFrom: function (date) {
        var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return 'moved from ' + Number(date.slice(8, 10)) + ' ' + months[Number(date.slice(5, 7)) - 1];
      },
      /** What applying does to the matched entry, by the kind of change the paper carries. */
      matchChange: {
        same: 'already matches',
        done: 'will be marked as done',
        migrated: 'will be marked as migrated',
        scheduled: 'will be marked as scheduled',
        dropped: 'will be marked as dropped',
        task: 'will be set to a task',
        note: 'will be set to a note',
        event: 'will be set to an event',
        fields: 'will update the entry'
      },
      /** A matched line that was un-matched: it is a new entry, and the item it matched is left alone. */
      notMatched: function (title) {
        return 'new entry, not ' + (title ? title : 'the moved entry');
      },
      /** The accessible names of the small hand-drawn button at the end of the note line. */
      unmatch: 'Not the same',
      rematch: 'Match again',
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
