/*
 * Sends the queued entries to the server, oldest first, one at a time. Needs outbox/model.js, outbox/queue.js and api.js.
 * Every send is safe to repeat: a create carries its client id (the server answers a repeat with the stored entry), an update
 * is a PATCH of fixed fields, an order is the same list again. So a lost answer, a second tab or a retry never makes a second entry.
 * hooks: sent(entry, item) after one item went through, dropped(item, error) when the server will never take it, finished(sentAny).
 * It stops at the first item that cannot be sent now (no network, a server error) and tries again later.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.outbox = L.outbox || {};

  var RETRY_MS = 15000;
  var hooks = null;
  var running = false;
  var again = false;
  var timer = null;

  /** True when the device says it has a connection (or does not say). */
  function online() {
    return navigator.onLine !== false;
  }

  /** Sends one item. A create then sets its indent, which a create cannot carry. Resolves with the saved entry (an order: the day it answered). */
  function send(item) {
    if (item.kind === 'update') return L.api.update(item.id, item.body);
    if (item.kind === 'order') return L.api.reorder(item.body, item.body.ids);
    return L.api.create(item.body).then(function (entry) {
      return item.indent === 1 && entry.indent !== 1 ? L.api.update(entry.id, { indent: 1 }) : entry;
    });
  }

  /** Tries again in a while, once. Not while the device knows it is offline (the online event does it then). */
  function later() {
    if (timer !== null || !online()) return;
    timer = window.setTimeout(function () { timer = null; flush(); }, RETRY_MS);
  }

  /** The item went through: it leaves the queue (or keeps what changed meanwhile) and the page learns the saved entry and the item that made it. */
  function sentOne(item, entry) {
    return L.outbox.queue.update(function (items) { return L.outbox.model.afterSent(items, item); }).then(function () {
      hooks.sent(entry, item);
    });
  }

  /** The server refused the item for good: it leaves the queue and the page says so. */
  function dropOne(item, error) {
    return L.outbox.queue.update(function (items) { return L.outbox.model.without(items, item.key); }).then(function () {
      hooks.dropped(item, error);
    });
  }

  /** Handles the first item: resolves true when the loop may go on to the next one. */
  function step(item, tally) {
    return send(item).then(function (entry) {
      tally.sent = true;
      return sentOne(item, entry).then(function () { return true; });
    }, function (error) {
      if (L.outbox.model.verdict(error, navigator.onLine) === 'later') { later(); return false; }
      return dropOne(item, error).then(function () { return true; });
    });
  }

  /** Works through the queue until it is empty or an item has to wait. */
  function drain(tally) {
    var first = L.outbox.queue.items()[0];
    if (!first) return Promise.resolve();
    return step(first, tally).then(function (go) { return go ? drain(tally) : null; });
  }

  /** Sends what is queued. A call while a flush runs makes it look at the queue once more when it ends. */
  function flush() {
    if (!hooks) return Promise.resolve();
    if (running) { again = true; return Promise.resolve(); }
    running = true;
    var tally = { sent: false };
    return L.outbox.queue.load().then(function () { return drain(tally); }).catch(function () { later(); }).then(function () {
      running = false;
      if (tally.sent) hooks.finished(true);
      if (again) { again = false; return flush(); }
      return null;
    });
  }

  /** Starts listening: a connection coming back and the app coming to the front both send what waits. */
  function init(options) {
    hooks = options;
    window.addEventListener('online', flush);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') flush(); });
    flush();
  }

  L.outbox.replay = { init: init, flush: flush };
})();
