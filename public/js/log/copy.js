/*
 * Rapid log copy: every string the person reads, in one place. Plain JS, no build step.
 * Logic files take their words from here.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};

  L.copy = {
    title: 'Rapid Log',
    scanLabel: 'Scan a page',
    today: 'Today',
    addEntry: '+ Add entry',
    notSynced: 'not synced',
    loading: 'Turning the page\u2026',
    loadFailed: 'Could not load the log. Try again.',
    retry: 'Try again',
    typeLabels: {
      task: 'Task',
      note: 'Note',
      event: 'Event',
      done: 'Done',
      migrated: 'Moved',
      scheduled: 'Scheduled'
    },
    sync: {
      local: 'Not synced',
      pending: 'Waiting to sync',
      synced: 'Synced',
      error: 'Sync failed'
    },
    inline: {
      titleLabel: 'Entry title',
      sheetLabel: 'Entry editor',
      barLabel: 'Entry options',
      keys: {
        type: 'Entry type',
        tag: 'Tag',
        date: 'Date',
        time: 'Time',
        remove: 'Delete entry',
        up: 'Move up',
        down: 'Move down',
        indent: 'Indent',
        outdent: 'Indent back',
        details: 'Details'
      },
      popLabels: { type: 'Choose a type', tag: 'Tags', date: 'Day', time: 'Time (optional)' },
      clear: 'Clear',
      tagSearch: 'Find or add a tag',
      tagSearchLabel: 'Search tags',
      tagList: 'Your tags',
      tagNone: 'No tags yet. Type one to add it.',
      tagAdd: function (text) { return '+ #' + text; },
      tagsFull: 'An entry holds at most 10 tags.'
    },
    suggest: {
      label: 'Suggestions',
      useTag: function (text) { return 'use ' + text; },
      weekdays: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'],
      relative: { heute: 'heute', morgen: 'morgen', '\u00fcbermorgen': '\u00fcbermorgen' },
      weekdayNames: {
        montag: 'Montag', dienstag: 'Dienstag', mittwoch: 'Mittwoch', donnerstag: 'Donnerstag',
        freitag: 'Freitag', samstag: 'Samstag', sonntag: 'Sonntag'
      }
    },
    sheet: {
      editTitle: 'Edit entry',
      type: 'Type',
      title: 'Title',
      tag: 'Tags (separated by spaces)',
      date: 'Date',
      time: 'Time (optional)',
      sync: 'Sync',
      save: 'Save',
      saving: 'Saving\u2026',
      retrySync: 'Retry sync',
      syncErrorFallback: 'The sync did not finish.'
    },
    errors: {
      titleRequired: 'Give the entry a title.',
      dateRequired: 'Pick a date.',
      saveFailed: 'Could not save. Try again.',
      lineFailed: 'Could not save this line. Try again.',
      actionFailed: 'Could not do that. Try again.',
      retryFailed: 'Could not retry the sync. Try again.'
    },
    note: {
      untitled: 'Untitled note',
      savedHeading: 'Note',
      savedSub: 'Saved in your log',
      dayHint: 'Tap to change the day',
      title: 'Title',
      date: 'Date',
      body: 'Markdown',
      saving: 'Saving\u2026',
      copy: 'Copy markdown',
      copied: 'Copied',
      copyFailed: 'Could not copy. Select the text and copy it by hand.',
      photoLabel: 'Scanned page',
      photoAlt: 'Photo of the scanned page',
      photoOpen: 'Open the photo full size',
      photoClose: 'Close the photo',
      photoFailed: 'The note is saved, but its photo could not be stored. Tap Save to try again.',
      titleRequired: 'Give the note a title.',
      dateRequired: 'Pick a date.',
      bodyRequired: 'Write something in the note.',
      saveFailed: 'Could not save the note. Try again.',
      save: 'Save'
    }
  };
})();
