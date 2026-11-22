/*
 * The queue the app works with: the outbox items in memory (the source of truth during a visit), saved to the store after each
 * change. Needs outbox/model.js and outbox/store.js. Changes go through update(), which runs a pure model function on the items.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.outbox = L.outbox || {};

  var current = [];
  var loaded = null;
  var writes = Promise.resolve();

  /** Reads the saved items once. Everything else waits for this, so a change never lands before the old items are known. */
  function load() {
    if (!loaded) loaded = L.outbox.store.all().then(function (items) { current = items; return items.slice(); });
    return loaded;
  }

  /** The items now, in queue order (a copy). Empty until load() has resolved. */
  function items() {
    return current.slice();
  }

  /** Saves the difference between two item lists: changed or new items are written, missing ones are removed. */
  function persist(before, after) {
    var store = L.outbox.store;
    var kept = {};
    var jobs = after.map(function (item) {
      kept[item.key] = true;
      return before.indexOf(item) >= 0 ? null : store.put(item);
    });
    before.forEach(function (item) { if (!kept[item.key]) jobs.push(store.remove(item.key)); });
    return Promise.all(jobs);
  }

  /** Applies make(items) to the queue and resolves with the new items once they are saved. The memory copy changes at once. */
  function update(make) {
    return load().then(function () {
      var before = current;
      current = make(before.slice());
      var after = current;
      writes = writes.then(function () { return persist(before, after); }).catch(function () { return null; });
      return writes.then(function () { return after.slice(); });
    });
  }

  L.outbox.queue = { load: load, items: items, update: update };
})();
