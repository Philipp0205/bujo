/*
 * Saving an entry from the log with the queue as the fallback. Needs outbox/model.js, outbox/queue.js and api.js.
 * create() and update() resolve with the entry to show. It is the server's answer when the call went through, or the entry as
 * it will be once the queue is sent (marked queued). A server refusal still rejects, so the line shows the reason.
 * While something is queued, a new entry joins the queue too, so entries are sent in the order they were written. A new order of a day
 * (reorder) does the same.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.outbox = L.outbox || {};

  /** True when a call failed because the device could not reach the server. */
  function missed(error) {
    return L.outbox.model.isNetworkMiss(error, navigator.onLine);
  }

  /** Puts a new entry in the queue and resolves with the entry it stands for. */
  function queueCreate(values, indent) {
    return L.outbox.queue.update(function (items) {
      return L.outbox.model.enqueueCreate(items, values, indent, new Date().toISOString());
    }).then(function (items) {
      return L.outbox.model.merge([], items).filter(function (entry) { return entry.id === values.id; })[0];
    });
  }

  /** Puts changes to a saved entry in the queue and resolves with the entry as it will look. */
  function queueUpdate(entry, patch) {
    return L.outbox.queue.update(function (items) {
      return L.outbox.model.enqueueUpdate(items, entry.id, patch, new Date().toISOString());
    }).then(function (items) {
      return L.outbox.model.preview(entry, items);
    });
  }

  /** The indent of a new entry follows its create, a second call that may miss on its own: then only that change is queued. */
  function setIndent(entry, indent) {
    if (indent !== 1) return Promise.resolve(entry);
    return L.api.update(entry.id, { indent: 1 }).catch(function (error) {
      if (!missed(error)) throw error;
      return queueUpdate(entry, { indent: 1 });
    });
  }

  /** Saves a new entry. values holds its client id. Resolves with the saved or queued entry. */
  function create(values, indent) {
    return L.outbox.queue.load().then(function () { return createNow(values, indent); });
  }

  function createNow(values, indent) {
    if (navigator.onLine === false || L.outbox.queue.items().length > 0) return queueCreate(values, indent);
    return L.api.create(values).then(function (entry) {
      return setIndent(entry, indent);
    }, function (error) {
      if (!missed(error)) throw error;
      return queueCreate(values, indent);
    });
  }

  /** Saves changes to an entry. Resolves with the saved or queued entry. */
  function update(entry, patch) {
    return L.outbox.queue.load().then(function () { return updateNow(entry, patch); });
  }

  function updateNow(entry, patch) {
    var waiting = L.outbox.queue.items().some(function (item) { return item.id === entry.id; });
    if (waiting || navigator.onLine === false) return queueUpdate(entry, patch);
    return L.api.update(entry.id, patch).catch(function (error) {
      if (!missed(error)) throw error;
      return queueUpdate(entry, patch);
    });
  }

  /** Puts a new order in the queue; it waits behind the entries it may name. Resolves with null. */
  function queueOrder(slot, ids) {
    return L.outbox.queue.update(function (items) {
      return L.outbox.model.enqueueOrder(items, slot, ids, new Date().toISOString());
    }).then(function () { return null; });
  }

  /** Saves a new order of some entries of one day. slot is { date, horizon }, ids the entries in their new order.
   * Resolves with the day as the server answered it, or with null when the order was queued (it shows through the queue). A refusal rejects. */
  function reorder(slot, ids) {
    return L.outbox.queue.load().then(function () {
      if (navigator.onLine === false || L.outbox.queue.items().length > 0) return queueOrder(slot, ids);
      return L.api.reorder(slot, ids).catch(function (error) {
        if (!missed(error)) throw error;
        return queueOrder(slot, ids);
      });
    });
  }

  /** Takes a queued new entry back out of the queue (it was never sent, so there is nothing to delete on the server). */
  function discard(id) {
    return L.outbox.queue.update(function (items) {
      return L.outbox.model.without(L.outbox.model.without(items, 'c:' + id), 'u:' + id);
    });
  }

  L.outbox.save = { create: create, update: update, reorder: reorder, discard: discard };
})();
