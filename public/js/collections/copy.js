/*
 * Collection copy: every string the person reads about collections (named pages), in one place. Plain JS, no build step.
 * Used by the Notes index, the collection page, the collection chooser and the type picker.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.collections = L.collections || {};

  L.collections.copy = {
    indexHeading: 'Collections',
    notesHeading: 'Notes',
    newNote: 'New note',
    newCollection: 'New collection',
    openLabel: 'Open collection',
    count: function (n) { return n === 1 ? '1 entry' : n + ' entries'; },

    back: 'Notes',
    backLabel: 'Back to the notes',
    addPlaceholder: 'Add an entry',
    addSave: 'Add',
    empty: 'Nothing on this page yet. Add an entry, or file a task from the log.',
    loading: 'Turning the page\u2026',
    loadFailed: 'Could not load this collection. Try again.',
    retry: 'Try again',
    addFailed: 'Could not add the entry. Try again.',

    pickerLabel: 'Collection',
    hintFile: 'file on a page',
    hintMove: 'change or leave',

    chooserTitle: 'File on a collection',
    chooserEmpty: 'No collections yet. Name the first one below.',
    chooserLoadFailed: 'Could not load your collections.',
    backToLog: 'Back to the daily log',
    nameTitle: 'New collection',
    namePlaceholder: 'Name a new collection',
    nameLabel: 'Collection name',
    nameCreate: 'Create',
    nameRequired: 'Give the collection a name.',
    nameFailed: 'Could not create the collection. Try again.'
  };
})();
