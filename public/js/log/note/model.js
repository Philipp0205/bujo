/*
 * Pure model of a free note on the client: the values the sheet edits, their checks and the bodies sent to /api/entries.
 * No DOM, no fetch, no strings to show (problems are keys that copy.js words).
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.note = L.note || {};

  var TITLE_MAX = 200;

  /** The sheet values for a scan: the server's suggestion, with a fallback title when the page gave none. */
  function fromSuggestion(suggestion, fallbackTitle) {
    return { id: null, title: suggestion.title || fallbackTitle, date: suggestion.date, body: suggestion.body };
  }

  /** The sheet values for a saved note. */
  function fromEntry(entry) {
    return { id: entry.id, title: entry.title, date: entry.date, body: entry.body || '' };
  }

  /** True for an entry that holds a free note: a short rapid-log line has no body. */
  function isNote(entry) {
    return typeof entry.body === 'string' && entry.body !== '';
  }

  /** 'title', 'date' or 'body' for the first thing that cannot be saved, else ''. */
  function problem(values) {
    if (values.title.trim() === '') return 'title';
    if (!values.date) return 'date';
    if (values.body.trim() === '') return 'body';
    return '';
  }

  /** The body to send: a new note is a note entry on its day, an edit sends the three fields. Same checks as the server. */
  function payload(values) {
    var fields = { date: values.date, title: values.title.trim().slice(0, TITLE_MAX), body: values.body };
    if (values.id === null) fields.type = 'note';
    return fields;
  }

  L.note.model = { fromSuggestion: fromSuggestion, fromEntry: fromEntry, isNote: isNote, problem: problem, payload: payload };
})();
