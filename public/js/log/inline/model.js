/*
 * Pure model of the line being typed in the rapid log: its values, and the fields to send. No DOM, no fetch, no strings.
 * A line is a new entry (id null) or an existing one being renamed in place. Needs nothing.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.inline = L.inline || {};

  var FIELDS = ['date', 'type', 'title', 'tag', 'time'];

  /** An empty new line: a task on the given day, with no tag or time. */
  function blank(date) {
    return { id: null, isNew: true, home: date, date: date, type: 'task', title: '', tag: null, time: null, original: null, error: '', saving: null };
  }

  /** A line that edits a saved entry. home is the day group it sits in until it is saved. */
  function fromEntry(entry) {
    return {
      id: entry.id,
      isNew: false,
      home: entry.date,
      date: entry.date,
      type: entry.type,
      title: entry.title,
      tag: entry.tag || null,
      time: entry.time || null,
      original: entry,
      error: '',
      saving: null
    };
  }

  /** True when the title has something other than spaces. */
  function hasTitle(line) {
    return line.title.trim() !== '';
  }

  /** All the fields of a line, as the API wants them. A blank tag or time is null so an edit can clear it. */
  function values(line) {
    return { date: line.date, type: line.type, title: line.title.trim(), tag: line.tag, time: line.time };
  }

  /** The fields to send: everything for a new line, only what differs from the saved entry for an edit. */
  function changes(line) {
    var next = values(line);
    if (line.isNew) return next;
    var out = {};
    FIELDS.forEach(function (key) {
      var before = line.original[key] === undefined ? null : line.original[key];
      if (before !== next[key]) out[key] = next[key];
    });
    return out;
  }

  L.inline.model = { blank: blank, fromEntry: fromEntry, hasTitle: hasTitle, changes: changes };
})();
