/*
 * Calls to /api/entries. Needs core.js (Bujo.request). A 401 sends the person to sign in.
 * Every function resolves with the parsed data and rejects with an Error that is safe to show.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};

  function call(method, path, body) {
    return Bujo.request(method, path, body, { guarded: true });
  }

  /** The entries from one day to another, both included. */
  function list(from, to) {
    return call('GET', '/api/entries?from=' + from + '&to=' + to).then(function (body) {
      return body.entries;
    });
  }

  /** The entries of a range followed by the traces moves left on its pages (as pseudo entries, see move/traces.js): one list the cache can hold. */
  function listWithTraces(from, to) {
    return call('GET', '/api/entries?from=' + from + '&to=' + to + '&traces=1').then(function (body) {
      return body.entries.concat((body.traces || []).map(L.move.traces.fromServer));
    });
  }

  /** Every open daily task from a day before `day`, however old (the server has no day cap for this one). */
  function listOpenBefore(day) {
    return call('GET', '/api/entries?openBefore=' + day).then(function (body) {
      return body.entries;
    });
  }

  /** The entries from one day to another that are not on paper yet (the server filters), both days included. */
  function listNotOnPaper(from, to) {
    return call('GET', '/api/entries?from=' + from + '&to=' + to + '&onPaper=0').then(function (body) {
      return body.entries;
    });
  }

  /** Says the person wrote an entry on the paper page. Resolves with the entry, which is then on paper. */
  function markWritten(id) {
    return call('POST', '/api/entries/' + encodeURIComponent(id) + '/written').then(function (body) {
      return body.entry;
    });
  }

  /** Every free note of any day, newest day first (the Notes screen). */
  function listNotes() {
    return call('GET', '/api/entries?kind=notes').then(function (body) {
      return body.entries;
    });
  }

  /** Every collection (a named page) with its entry count, in the order they were made. */
  function listCollections() {
    return call('GET', '/api/collections').then(function (body) {
      return body.collections;
    });
  }

  /** A new collection with this name. Resolves with it (the one that exists already when the name is taken). */
  function createCollection(name) {
    return call('POST', '/api/collections', { name: name }).then(function (body) {
      return body.collection;
    });
  }

  /** Renames a collection. Resolves with it; rejects with status 409 when another collection has the name. */
  function renameCollection(id, name) {
    return call('PATCH', '/api/collections/' + encodeURIComponent(id), { name: name }).then(function (body) {
      return body.collection;
    });
  }

  /** Sets (a whole number) or clears (null) the notebook page number of a collection. Resolves with it; rejects with the server's error text in message. */
  function setCollectionPage(id, page) {
    return call('PATCH', '/api/collections/' + encodeURIComponent(id), { paperPage: page }).then(function (body) {
      return body.collection;
    });
  }

  /** Deletes a collection. Its entries stay in the log, back on their days. */
  function deleteCollection(id) {
    return call('DELETE', '/api/collections/' + encodeURIComponent(id));
  }

  /** One collection and the entries filed on it, in page order: { collection, entries }. */
  function listCollection(id) {
    return call('GET', '/api/entries?collection=' + encodeURIComponent(id));
  }

  function create(values) {
    return call('POST', '/api/entries', values).then(function (body) {
      return body.entry;
    });
  }

  function update(id, values) {
    return call('PATCH', '/api/entries/' + encodeURIComponent(id), values).then(function (body) {
      return body.entry;
    });
  }

  /** The tags in use, newest first: [{ tag, count, lastUsed }]. Feeds the autocomplete. */
  function listTags() {
    return call('GET', '/api/tags').then(function (body) {
      return body.tags;
    });
  }

  /** Removes an entry from the log (never from Nextcloud). Resolves with the entries left in its day. */
  function remove(id) {
    return call('DELETE', '/api/entries/' + encodeURIComponent(id)).then(function (body) {
      return body.entries;
    });
  }

  /** Swaps an entry with its neighbour in the day ('up' or 'down'). Resolves with the day in its new order. */
  function move(id, direction) {
    return call('POST', '/api/entries/' + encodeURIComponent(id) + '/move', { direction: direction }).then(function (body) {
      return body.entries;
    });
  }

  /** Adds a task as a new last line of a free-form note and takes it off the log. Resolves with { note, entries } (the note, the task's old day). */
  function fileIntoNote(id, noteId) {
    return call('POST', '/api/entries/' + encodeURIComponent(id) + '/into-note', { noteId: noteId });
  }

  /** Asks the server to push an entry again after a failed sync. Resolves with the entry as it is now (pending). */
  function retrySync(id) {
    return call('POST', '/api/entries/' + encodeURIComponent(id) + '/sync').then(function (body) {
      return body.entry;
    });
  }

  /** Stores the scan photo (a JPEG Blob) with a note. Resolves with the entry, which then has hasPhoto. */
  function uploadPhoto(id, blob) {
    return Bujo.upload('/api/entries/' + encodeURIComponent(id) + '/photo', blob, { guarded: true }).then(function (body) {
      return body.entry;
    });
  }

  /** The address of a note's stored photo. The server answers it for the signed-in owner only. */
  function photoUrl(id) {
    return '/api/entries/' + encodeURIComponent(id) + '/photo';
  }

  L.api = { list: list, listWithTraces: listWithTraces, listOpenBefore: listOpenBefore, listNotOnPaper: listNotOnPaper, markWritten: markWritten, listNotes: listNotes, listCollections: listCollections, createCollection: createCollection, renameCollection: renameCollection, setCollectionPage: setCollectionPage, deleteCollection: deleteCollection, listCollection: listCollection, listTags: listTags, create: create, update: update, remove: remove, fileIntoNote: fileIntoNote, move: move, retrySync: retrySync, uploadPhoto: uploadPhoto, photoUrl: photoUrl };
})();
