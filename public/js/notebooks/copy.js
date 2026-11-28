/*
 * Notebooks copy: every string the person reads on the notebook list, the start-a-notebook sheet and the notebook detail, in one place.
 * Plain JS, no build step.
 */
(function () {
  'use strict';

  var N = window.BujoNotebooks = window.BujoNotebooks || {};

  N.copy = {
    title: 'Notes',
    start: 'Start new notebook',
    activeMark: 'Active',
    pageCount: function (n) { return n === 1 ? '1 page' : n + ' pages'; },
    scannedCount: function (scanned, total) { return scanned + ' of ' + total + ' pages scanned'; },
    since: function (from) { return 'Since ' + from; },
    range: function (from, to) { return from + ' to ' + to; },
    openLabel: function (name) { return 'Open notebook: ' + name; },
    back: 'Notebooks',
    backLabel: 'Back to the notebooks',
    indexBack: 'Notebook',
    indexBackLabel: 'Back to the notebook',
    indexOpenLabel: 'Open the page numbers of this notebook',
    sheetTitle: 'Start a new notebook',
    sheetNote: 'The notebook you write in now ends today. New scans go to the new one.',
    nameCaption: 'Name',
    pagesCaption: 'Pages',
    namePlaceholder: 'Name, like Notebook 2',
    nameLabel: 'Notebook name',
    pagesPlaceholder: 'Pages',
    pagesLabel: 'Number of pages',
    sheetSave: 'Start notebook',
    nameRequired: 'Give the notebook a name.',
    pagesInvalid: 'Pages must be a whole number from 1 to 9999.',
    startFailed: 'Could not start the notebook. Try again.',
    defaultName: function (n) { return 'Notebook ' + n; },
    defaultPages: '100',
    sections: {
      daily: 'Daily logs',
      month: 'Monthly logs',
      future: 'Future logs',
      collections: 'Collections and notes',
      index: 'Index'
    },
    sectionEmpty: 'Nothing scanned yet.',
    collectionsEmpty: 'No collections or notes in this notebook yet.',
    indexLegend: 'Filled numbers are scanned. Tap one to open it, or its photo if it has one.',
    openPage: function (number, label) { return 'Open page ' + number + ', ' + label; },
    openPagePhoto: function (number, label) { return 'Open the photo of page ' + number + ', ' + label; }
  };
})();
