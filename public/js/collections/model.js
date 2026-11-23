/*
 * Pure model of collections on the client: the bodies that file an entry on a collection or take it back, the body of a new entry
 * typed on a collection page, and the name check. No DOM, no fetch, no words. Needs markup.js (the same line markup as the log).
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.collections = L.collections || {};

  var NAME_MAX = 60;

  /** The change that files an entry on a collection. */
  function fileBody(collectionId) {
    return { collectionId: collectionId };
  }

  /** The change that puts an entry back on the daily log, on today's page. */
  function leaveBody(today) {
    return { collectionId: null, date: today };
  }

  /** The name to send (one line, trimmed, within the limit), or '' when there is nothing to send. */
  function cleanName(text) {
    return String(text).replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
  }

  /** The body of a new entry typed on a collection page: a task with the tags and time the line writes, filed on the collection. A day written in it is ignored. */
  function newEntry(text, today, collectionId) {
    var found = L.markup.parse(text, { final: true, today: today });
    var title = found.title.trim();
    if (title === '') return null;
    return { date: today, horizon: 'day', type: 'task', title: title, tags: found.tags, time: found.time, collectionId: collectionId };
  }

  L.collections.model = { fileBody: fileBody, leaveBody: leaveBody, cleanName: cleanName, newEntry: newEntry };
})();
