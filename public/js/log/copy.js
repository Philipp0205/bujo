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
    settingsLabel: 'Settings',
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
    sheet: {
      createTitle: 'New entry',
      editTitle: 'Edit entry',
      type: 'Type',
      title: 'Title',
      tag: 'Tag',
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
      titleRequired: 'Give the note a title.',
      dateRequired: 'Pick a date.',
      bodyRequired: 'Write something in the note.',
      saveFailed: 'Could not save the note. Try again.',
      save: 'Save'
    }
  };
})();
