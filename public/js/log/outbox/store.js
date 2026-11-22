/*
 * The outbox on disk: one IndexedDB store of queued items, so entries written offline survive a closed tab. Storage only, no
 * queue rules (those are in model.js and queue.js). When IndexedDB is missing or blocked (private mode), the items live in
 * memory for this visit and nothing breaks. Every call resolves, none rejects for a missing database.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.outbox = L.outbox || {};

  var DB_NAME = 'bujo-outbox';
  var STORE = 'items';
  var opened = null;
  var memory = {};

  /** Opens the database once. Resolves with it, or with null when there is none to use. */
  function open() {
    if (opened) return opened;
    opened = new Promise(function (resolve) {
      if (!window.indexedDB) { resolve(null); return; }
      var request;
      try { request = window.indexedDB.open(DB_NAME, 1); } catch (ignored) { resolve(null); return; }
      request.onupgradeneeded = function () { request.result.createObjectStore(STORE, { keyPath: 'key' }); };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { resolve(null); };
      request.onblocked = function () { resolve(null); };
    });
    return opened;
  }

  /** Runs one request in a transaction and resolves with its result once the transaction is done. */
  function run(mode, make) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, mode);
        var request = make(tx.objectStore(STORE));
        tx.oncomplete = function () { resolve(request.result); };
        tx.onerror = tx.onabort = function () { reject(tx.error); };
      });
    });
  }

  /** Every queued item, in queue order. */
  function all() {
    return open().then(function (db) {
      if (!db) return Object.keys(memory).map(function (key) { return memory[key]; });
      return run('readonly', function (store) { return store.getAll(); });
    }).then(function (items) {
      return items.sort(function (a, b) { return a.order - b.order; });
    }, function () { return []; });
  }

  /** Writes one item (a new one, or a changed one under the same key). */
  function put(item) {
    return open().then(function (db) {
      if (!db) { memory[item.key] = item; return null; }
      return run('readwrite', function (store) { return store.put(item); });
    });
  }

  /** Removes one item by key. */
  function remove(key) {
    return open().then(function (db) {
      if (!db) { delete memory[key]; return null; }
      return run('readwrite', function (store) { return store.delete(key); });
    });
  }

  L.outbox.store = { all: all, put: put, remove: remove };
})();
