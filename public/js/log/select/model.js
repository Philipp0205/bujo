/*
 * The selection of the rapid log: which entries are ticked, and the page (day and horizon) of the one ticked last. Pure: no DOM, no strings.
 * Entries are kept by id, so a parent and its nested entries are ticked on their own and a redraw never loses the choice.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.select = L.select || {};

  var ids = {};
  var lastDate = null;
  var lastHorizon = null;

  /** True when the entry is ticked. */
  function has(id) {
    return ids[id] === true;
  }

  /** Remembers the page of the entry ticked last: "select day" works on it. A daily log day and a calendar day are two pages. */
  function remember(entry) {
    lastDate = entry.date;
    lastHorizon = entry.horizon || 'day';
  }

  /** Ticks an entry (one that is already ticked stays). */
  function add(entry) {
    ids[entry.id] = true;
    remember(entry);
  }

  /** Ticks an entry that is off and unticks one that is on. */
  function toggle(entry) {
    if (has(entry.id)) delete ids[entry.id];
    else ids[entry.id] = true;
    remember(entry);
  }

  /** Ticks every entry of the page of the one toggled last (its day in the daily log, or its day on the calendar), nested ones too. */
  function addDay(entries) {
    entries.forEach(function (entry) {
      if (entry.date === lastDate && (entry.horizon || 'day') === lastHorizon && L.days.hasDay(lastHorizon)) ids[entry.id] = true;
    });
  }

  /** The ticked entries among the ones on screen (an id whose entry is gone is skipped). */
  function pick(entries) {
    return entries.filter(function (entry) { return has(entry.id); });
  }

  /** Unticks everything and forgets the page. */
  function clear() {
    ids = {};
    lastDate = null;
    lastHorizon = null;
  }

  L.select.model = { has: has, add: add, toggle: toggle, addDay: addDay, pick: pick, clear: clear };
})();
