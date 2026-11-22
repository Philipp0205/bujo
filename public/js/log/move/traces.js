/*
 * Pure model of traces: the muted ">" and "<" lines a move leaves on the page an entry came from. A trace is local: it has no UID and
 * is never an entry on the server. On the client a trace is a pseudo entry ({ isTrace: true }) so the pages, the Month view and the
 * Future view can draw it where it was. state.entries holds live entries only (every editing path reads those); state.traces holds the
 * pseudo entries, and withTraces() joins the two at render time. The cache holds one plain list (live entries, then traces), which
 * split() takes apart again, so a list cached before traces existed still loads. No DOM, no fetch, no words. Needs nothing.
 *
 * A pseudo entry is { id: 'trace:...', isTrace: true, entryId, date, horizon, type: 'migrated' | 'scheduled', title, ... }.
 * A move that is still in the outbox has no server trace yet: derive() makes it from the queued update, and hides the trace of a page
 * the queued update brings the entry back to.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.move = L.move || {};

  /** Traces sort after the live entries of their page. */
  var LAST = 1000000000;

  /** True for a trace pseudo entry. */
  function isTrace(entry) {
    return entry.isTrace === true;
  }

  function horizonOf(entry) {
    return entry.horizon || 'day';
  }

  /** The pseudo entry of a trace: source is a server trace ({ id, entryId, date, horizon, kind, title, createdAt }) or the same made here. */
  function make(id, source) {
    return {
      id: id, isTrace: true, entryId: source.entryId, date: source.date, horizon: horizonOf(source), type: source.kind, title: source.title,
      tags: [], time: null, body: null, indent: 0, position: LAST, createdAt: source.createdAt || 0, sync: 'synced', onPaper: true
    };
  }

  /** The pseudo entry of a trace the server sent. */
  function fromServer(trace) {
    return make('trace:' + trace.id, trace);
  }

  /** The pseudo entry for a move made here, from the entry as it was and the kind of move. One per old page, so a repeat is never drawn twice. */
  function local(before, kind) {
    return make('trace:local:' + before.id + ':' + horizonOf(before) + ':' + before.date, {
      entryId: before.id, date: before.date, horizon: horizonOf(before), kind: kind, title: before.title, createdAt: 0
    });
  }

  /** The cached or fetched list taken apart: { entries, traces }. A list with no traces in it has an empty trace list. */
  function split(list) {
    return {
      entries: list.filter(function (entry) { return !isTrace(entry); }),
      traces: list.filter(isTrace)
    };
  }

  /** The entries with the traces after them, for drawing a page. The result is never stored. */
  function withTraces(entries, traces) {
    return traces.length ? entries.concat(traces) : entries;
  }

  /** True when two entries or traces sit on the same page (a day, or a month lane). */
  function samePage(a, b) {
    return a.date === b.date && horizonOf(a) === horizonOf(b);
  }

  /** The page a queued update puts an entry on. */
  function landing(entry, body) {
    return { date: body.date || entry.date, horizon: body.horizon || horizonOf(entry) };
  }

  /** Whether a trace of this entry already stands on this page. */
  function present(traces, entryId, page) {
    return traces.some(function (trace) { return trace.entryId === entryId && samePage(trace, page); });
  }

  /** The traces without those of one entry on one page (the entry is home again there, so the page holds the entry itself). */
  function clearAt(traces, entryId, page) {
    return traces.filter(function (trace) { return !(trace.entryId === entryId && samePage(trace, page)); });
  }

  /** The traces after one queued update: a move to another page that asked for a trace adds it, a move back home takes that page's trace off. */
  function afterQueued(traces, before, item) {
    var next = landing(before, item.body);
    if (samePage(before, next)) return traces;
    var out = clearAt(traces, before.id, next);
    if (!item.body.trace || present(out, before.id, before)) return out;
    return out.concat([local(before, item.body.trace)]);
  }

  /**
   * The traces the person sees: the server's, then what the queue changes. live is the server's list of live entries (the old pages are
   * read from it), items the outbox. A queued update of an entry the server does not have yet, or one that stays on its page, adds nothing.
   */
  function derive(serverTraces, live, items) {
    return items.reduce(function (traces, item) {
      var before = item.kind === 'update' ? live.filter(function (entry) { return entry.id === item.id; })[0] : null;
      return before ? afterQueued(traces, before, item) : traces;
    }, serverTraces);
  }

  /** The server traces after a move that went through: the trace on the old page, and none on the page the entry arrived at. */
  function afterMove(serverTraces, before, after, kind) {
    var out = clearAt(serverTraces, after.id, after);
    if (!kind || samePage(before, after) || present(out, before.id, before)) return out;
    return out.concat([local(before, kind)]);
  }

  /** The traces without those of one entry (it was deleted, and its traces went with it). */
  function forget(traces, entryId) {
    return traces.filter(function (trace) { return trace.entryId !== entryId; });
  }

  L.move.traces = {
    isTrace: isTrace, fromServer: fromServer, split: split, withTraces: withTraces, derive: derive, afterMove: afterMove, forget: forget
  };
})();
