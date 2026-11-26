/*
 * The delete of select mode: removes the ticked entries one by one the way a single delete does (L.api.remove for a saved entry,
 * L.outbox.save.discard for a queued new one, never Nextcloud directly). It answers the entries that could not be removed.
 * No DOM, no strings. Needs api.js and outbox/save.js.
 * host: group(horizon, date), replaceGroup(horizon, date, entries), forget(id), the same page host the inline editor uses.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.select = L.select || {};

  /** The page group (horizon and date) an entry sits in. */
  function groupOf(entry) {
    return { horizon: entry.horizon || 'day', date: entry.date };
  }

  /** Drops a queued new entry from its group once its queue item is discarded. */
  function discard(entry, host) {
    var at = groupOf(entry);
    return L.outbox.save.discard(entry.id).then(function () {
      host.replaceGroup(at.horizon, at.date, host.group(at.horizon, at.date).filter(function (other) { return other.id !== entry.id; }));
    });
  }

  /** Deletes a saved entry on the server; the answer is its group's new list. */
  function destroy(entry, host) {
    var at = groupOf(entry);
    return L.api.remove(entry.id).then(function (entries) {
      host.forget(entry.id);
      host.replaceGroup(at.horizon, at.date, entries);
    });
  }

  /** Removes one entry by the path that fits it. */
  function removeOne(entry, host) {
    return entry.queued === 'create' ? discard(entry, host) : destroy(entry, host);
  }

  /** Removes the entries one after the other (a day's list changes under each delete). Resolves with the entries that failed. */
  function removeAll(entries, host) {
    var failed = [];
    return entries.reduce(function (chain, entry) {
      return chain.then(function () {
        return removeOne(entry, host).catch(function () { failed.push(entry); });
      });
    }, Promise.resolve()).then(function () { return failed; });
  }

  L.select.remove = { removeAll: removeAll };
})();
