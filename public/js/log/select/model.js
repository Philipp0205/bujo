/*
 * The selection of the rapid log: which entries are ticked, and the day of the one ticked last. Pure: no DOM, no strings.
 * Entries are kept by id, so a parent and its nested entries are ticked on their own and a redraw never loses the choice.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.select = L.select || {};

  var ids = {};
  var lastDate = null;

  /** True when the entry is ticked. */
  function has(id) {
    return ids[id] === true;
  }

  /** Ticks an entry (one that is already ticked stays). The day of this entry is the one "select day" works on. */
  function add(entry) {
    ids[entry.id] = true;
    lastDate = entry.date;
  }

  /** Ticks an entry that is off and unticks one that is on. */
  function toggle(entry) {
    if (has(entry.id)) delete ids[entry.id];
    else ids[entry.id] = true;
    lastDate = entry.date;
  }

  /** Ticks every day entry of the day of the one toggled last, nested ones too. */
  function addDay(entries) {
    entries.forEach(function (entry) {
      if (entry.date === lastDate && (entry.horizon || 'day') === 'day') ids[entry.id] = true;
    });
  }

  /** The ticked entries among the ones on screen (an id whose entry is gone is skipped). */
  function pick(entries) {
    return entries.filter(function (entry) { return has(entry.id); });
  }

  /** Unticks everything and forgets the day. */
  function clear() {
    ids = {};
    lastDate = null;
  }

  L.select.model = { has: has, add: add, toggle: toggle, addDay: addDay, pick: pick, clear: clear };
})();
