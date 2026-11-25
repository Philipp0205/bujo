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
    nameFailed: 'Could not create the collection. Try again.',

    rename: 'Rename',
    renameTitle: 'Rename collection',
    renameSave: 'Save',
    nameTaken: 'Another collection already has that name.',
    renameFailed: 'Could not rename the collection. Try again.',
    delete: 'Delete page',
    deleteTitle: function (name) { return 'Delete \u201c' + name + '\u201d?'; },
    deleteBody: 'This page will be removed. Its entries are not deleted: they stay in the log, on their days.',
    deleteConfirm: 'Delete page',
    deleteCancel: 'Cancel',
    deleteFailed: 'Could not delete the page. Try again.',

    pageMark: function (n) { return 'p. ' + n; },
    pageAction: 'Page number',
    pageTitle: 'Page number in your notebook',
    pageLabel: 'Notebook page number (1 to 9999)',
    pagePlaceholder: 'Page 1 to 9999',
    pageSave: 'Save',
    pageClear: 'No page number',
    pageInvalid: 'Use a whole number from 1 to 9999.',
    pageFailed: 'Could not save the page number. Try again.'
  };
})();
