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
    scanHint: 'Scan comes later',
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
      saving: 'Saving\u2026'
    },
    errors: {
      titleRequired: 'Give the entry a title.',
      dateRequired: 'Pick a date.',
      saveFailed: 'Could not save. Try again.'
    }
  };
})();
