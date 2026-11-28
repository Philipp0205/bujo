/*
 * Pure model of the outbox: entries written while the device could not reach the server, waiting to be sent in order.
 * No DOM, no fetch, no storage, no words. Needs nothing (newId needs window.crypto when it runs).
 *
 * An item is { key, kind, id, body, indent, at, order, rev }:
 *   kind 'create'  a new entry (body holds its client id and fields, horizon included, indent is 0 or 1, which a create cannot carry);
 *   kind 'update'  changes to a saved entry (body holds only the changed fields);
 *   kind 'order'   a drag and drop in one day (id is null, body is { date, horizon, ids }: those entries in their new order). One per day, the last drag wins.
 * An edit of an entry whose create is still queued goes into that create, so the server sees one POST. rev counts the changes
 * of an item, so a change made while the item is being sent is not lost.
 * Entries made from items carry queued: 'create' or 'update'. That flag is client only, the server never sees it.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.outbox = L.outbox || {};

  var HEX = '0123456789abcdef';

  /** A new entry id the server accepts: a version 4 UUID in lowercase. Falls back to getRandomValues outside a secure page. */
  function newId() {
    var source = window.crypto;
    if (source && source.randomUUID) return source.randomUUID();
    var bytes = new Uint8Array(16);
    source.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    var hex = Array.prototype.map.call(bytes, function (byte) { return HEX[byte >> 4] + HEX[byte & 15]; }).join('');
    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
  }

  /** True when a failed call never reached the server (a rejected fetch, or the device says it is offline). A server answer is not one. */
  function isNetworkMiss(error, online) {
    if (online === false) return true;
    return !!error && !error.status && error.name === 'TypeError' && /fetch|network|load failed/i.test(error.message || '');
  }

  /** What to do with a queued item whose send failed: 'later' keeps it for the next try, 'drop' means the server will never take it. */
  function verdict(error, online) {
    if (isNetworkMiss(error, online)) return 'later';
    var status = error && error.status;
    if (!status || status >= 500 || status === 408 || status === 429) return 'later';
    return 'drop';
  }

  function nextOrder(items) {
    var top = items.reduce(function (most, item) { return Math.max(most, item.order); }, 0);
    return Math.max(top + 1, Date.now());
  }

  function without(items, key) {
    return items.filter(function (item) { return item.key !== key; });
  }

  /** True when a new entry with this id still waits in the queue (the server may not know it yet). */
  function hasCreate(items, id) {
    return items.some(function (item) { return item.kind === 'create' && item.id === id; });
  }

  /** Adds a new entry to the end of the queue. values holds its client id. Queuing the same id again replaces its fields. */
  function enqueueCreate(items, values, indent, now) {
    var key = 'c:' + values.id;
    var old = items.find(function (item) { return item.key === key; });
    var item = { key: key, kind: 'create', id: values.id, body: values, indent: indent || 0, at: old ? old.at : now, order: old ? old.order : nextOrder(items), rev: old ? old.rev + 1 : 0 };
    return old ? items.map(function (each) { return each.key === key ? item : each; }) : items.concat([item]);
  }

  /** Replaces one item and counts the change. */
  function changed(items, item, body, indent) {
    var next = Object.assign({}, item, { body: Object.assign({}, item.body, body), rev: item.rev + 1 });
    if (indent !== undefined) next.indent = indent;
    return items.map(function (each) { return each.key === item.key ? next : each; });
  }

  /** Queues changes to a saved entry. They join the entry's queued create or its queued update, else become a new update.
   * A trace is for the old page on the server, which a queued create has none of, so it never goes into a create. */
  function enqueueUpdate(items, id, patch, now) {
    var create = items.find(function (item) { return item.kind === 'create' && item.id === id; });
    var fields = Object.assign({}, patch);
    var indent = fields.indent;
    delete fields.indent;
    delete fields.trace;
    if (create) return changed(items, create, fields, indent);
    var update = items.find(function (item) { return item.kind === 'update' && item.id === id; });
    if (update) return changed(items, update, patch);
    return items.concat([{ key: 'u:' + id, kind: 'update', id: id, body: Object.assign({}, patch), indent: 0, at: now, order: nextOrder(items), rev: 0 }]);
  }

  /** The entries with some of one group (a day or a month's lane) put in the order of `ids`, in the places those entries held (the places are their own positions, handed out in order). Entries of other groups and unnamed entries stay. A new list, the entries are copies. */
  function reposition(entries, slot, ids) {
    var inSlot = function (entry) { return !entry.isTrace && entry.date === slot.date && (entry.horizon || 'day') === slot.horizon; };
    var named = ids.map(function (id) { return entries.find(function (entry) { return entry.id === id && inSlot(entry); }); }).filter(Boolean);
    var places = named.map(function (entry) { return entry.position; }).sort(function (a, b) { return a - b; });
    var next = {};
    named.forEach(function (entry, at) { next[entry.id] = places[at]; });
    return entries.map(function (entry) { return next[entry.id] === undefined ? entry : Object.assign({}, entry, { position: next[entry.id] }); });
  }

  /** Queues a new order for one group. A later order for the same group replaces the earlier one (the last drag wins) and goes to the end of the queue, behind any entry created since. slot is { date, horizon }. */
  function enqueueOrder(items, slot, ids, now) {
    var key = 'o:' + slot.horizon + ':' + slot.date;
    var old = items.find(function (item) { return item.key === key; });
    var item = { key: key, kind: 'order', id: null, body: { date: slot.date, horizon: slot.horizon, ids: ids.slice() }, indent: 0, at: old ? old.at : now, order: nextOrder(items), rev: old ? old.rev + 1 : 0 };
    return without(items, key).concat([item]);
  }

  /** The items after one was sent: it leaves the queue, unless it changed while it was in flight (then the rest stays queued). */
  function afterSent(items, sent) {
    var current = items.find(function (item) { return item.key === sent.key; });
    if (!current) return items;
    if (current.rev === sent.rev) return without(items, sent.key);
    if (current.kind !== 'create') return items;
    var rest = Object.assign({}, current.body);
    delete rest.id;
    return items.map(function (item) {
      return item.key === sent.key ? { key: 'u:' + current.id, kind: 'update', id: current.id, body: rest, indent: 0, at: current.at, order: current.order, rev: 0 } : item;
    });
  }

  /** The place after the last entry of a group (a day, or a month's month-task or future items). */
  function nextPosition(entries, date, horizon) {
    return entries.reduce(function (top, entry) {
      return entry.date === date && (entry.horizon || 'day') === horizon ? Math.max(top, entry.position + 1) : top;
    }, 0);
  }

  /** The entry a queued create stands for in the log: what the server would have answered, marked as queued. */
  function entryOf(item, position) {
    var body = item.body;
    return {
      id: item.id, date: body.date, horizon: body.horizon || 'day', time: body.time || null, type: body.type, title: body.title, tags: (body.tags || []).slice(),
      body: body.body || null, important: body.important === true, hasPhoto: false, sync: 'local', syncError: null, position: position, page: null, indent: item.indent,
      createdAt: item.at, updatedAt: item.at, onPaper: false, queued: 'create'
    };
  }

  /** An entry with the queued changes for it applied, marked as queued. An entry with none comes back as it was (no queued mark).
   * A queued move that asks for a trace leaves the entry off paper (its paper line is on the old page); the trace itself is no entry field. */
  function overlay(entry, items) {
    var plain = Object.assign({}, entry);
    delete plain.queued;
    return items.filter(function (item) { return item.kind === 'update' && item.id === entry.id; }).reduce(function (shown, item) {
      var next = Object.assign({}, shown, item.body, { queued: 'update' });
      if (item.body.trace) next.onPaper = false;
      delete next.trace;
      return next;
    }, plain);
  }

  /** One entry as it looks with the queue applied: a queued create is rebuilt from its item, a saved entry gets its pending changes. */
  function preview(entry, items) {
    var create = items.find(function (item) { return item.kind === 'create' && item.id === entry.id; });
    return create ? entryOf(create, entry.position) : overlay(entry, items);
  }

  /**
   * The log the person sees: the server's entries with queued changes applied, then the queued new entries at the end of their
   * days, in queue order. Joined by id: a server entry wins over a queued create with the same id (it was sent, the answer
   * is in). Entries that stand for a queued create are rebuilt from the items, so one whose item is gone disappears.
   */
  function merge(base, items) {
    var out = base.filter(function (entry) { return entry.queued !== 'create'; }).map(function (entry) { return overlay(entry, items); });
    var seen = {};
    out.forEach(function (entry) { seen[entry.id] = true; });
    items.forEach(function (item) {
      if (item.kind !== 'create' || seen[item.id]) return;
      seen[item.id] = true;
      out.push(entryOf(item, nextPosition(out, item.body.date, item.body.horizon || 'day')));
    });
    return items.filter(function (item) { return item.kind === 'order'; }).reduce(function (shown, item) {
      return reposition(shown, item.body, item.body.ids);
    }, out);
  }

  L.outbox.model = {
    newId: newId, isNetworkMiss: isNetworkMiss, verdict: verdict, hasCreate: hasCreate, without: without,
    enqueueCreate: enqueueCreate, enqueueUpdate: enqueueUpdate, enqueueOrder: enqueueOrder, reposition: reposition, afterSent: afterSent,
    preview: preview, merge: merge
  };
})();
