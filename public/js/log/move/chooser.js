/*
 * The move chooser: the compact paper card that opens when the type marker is set to Moved (>) or Scheduled (<). It lists the places
 * the entry can go (this day, the next day, a day of your choice, this month, one of the later months) and calls back with the pick.
 * It lives in the edit sheet like the type chooser, so a press on it keeps the title focused. It builds nodes and calls back,
 * it never changes a line. Needs ak-dom.js, copy.js, glyph.js, edit-sheet.js and move/model.js.
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};
  L.move = L.move || {};

  var node = null;

  /** One quick option: a labelled button for a place (or for "this day", with no place). */
  function option(label, key, selected, onPick) {
    return h('button', {
      class: 'move-option', type: 'button', 'data-dest': key, 'aria-pressed': key === selected ? 'true' : 'false', onclick: onPick
    }, label);
  }

  /** The "pick a day" row: a native date field, so the phone shows its own calendar. A chosen day is a pick. */
  function dayField(selected, onPick) {
    var input = h('input', {
      class: 'move-date', type: 'date', name: 'move-date', 'aria-label': L.copy.move.pickDayLabel, 'data-testid': 'move-date',
      value: selected && selected.indexOf('day:') === 0 ? selected.slice(4) : ''
    });
    input.addEventListener('change', function () { if (input.value) onPick(L.move.model.dayPlace(input.value)); });
    return h('label', { class: 'move-option move-day' }, h('span', { class: 'move-day-label' }, L.copy.move.pickDay), input);
  }

  /** The quick row: this day (a schedule on a day), next day, pick a day, this month. A place the entry is in already is left out. */
  function quick(choices, selected, onPick) {
    var row = h('div', { class: 'move-quick' });
    if (choices.here) row.appendChild(option(L.copy.move.thisDay, 'here', selected, function () { onPick(null); }));
    if (choices.next) row.appendChild(option(L.copy.move.nextDay, choices.next.key, selected, function () { onPick(choices.next); }));
    row.appendChild(dayField(selected, onPick));
    if (choices.thisMonth) row.appendChild(option(L.copy.move.thisMonth, choices.thisMonth.key, selected, function () { onPick(choices.thisMonth); }));
    return row;
  }

  /** One chip of the months grid: the short month name (with the year when it is not this year's), the full name for a screen reader. */
  function chip(place, selected, today, onPick) {
    var month = place.key.slice(6);
    return h('button', {
      class: 'move-chip', type: 'button', 'data-dest': place.key, 'aria-pressed': place.key === selected ? 'true' : 'false',
      'aria-label': L.copy.move.monthLabel(month), onclick: function () { onPick(place); }
    }, L.copy.horizon.chip(month, today.slice(0, 4)));
  }

  /** The later months as a grid of chips. */
  function monthGrid(choices, selected, today, onPick) {
    return h('div', { class: 'move-months', role: 'group', 'aria-label': L.copy.move.futureHeading },
      choices.months.map(function (place) { return chip(place, selected, today, onPick); }));
  }

  /** True while the chooser is open. */
  function isOpen() {
    return node !== null;
  }

  /** Closes the chooser, if one is open. */
  function close() {
    if (node) node.remove();
    node = null;
    var marker = document.querySelector('.type-marker');
    if (marker) marker.setAttribute('aria-expanded', 'false');
  }

  /**
   * Opens the chooser above the sheet. spec: kind ('migrate' or 'schedule'), choices (L.move.model.options), selected (the key of the
   * place the line is filed in already, or null), today, onPick(place or null).
   */
  function open(spec) {
    close();
    var title = spec.kind === 'schedule' ? L.copy.move.scheduleTitle : L.copy.move.migrateTitle;
    node = h('div', {
      class: 'move-chooser', role: 'group', 'aria-label': L.copy.move.chooserLabel, 'data-testid': 'move-chooser', 'data-kind': spec.kind
    }, h('div', { class: 'move-heading' }, L.glyph.typeGlyph(L.move.model.KINDS[spec.kind]), h('span', null, title)),
    quick(spec.choices, spec.selected, spec.onPick), monthGrid(spec.choices, spec.selected, spec.today, spec.onPick));
    L.inline.editSheet.element().appendChild(node);
    var marker = document.querySelector('.type-marker');
    if (marker) marker.setAttribute('aria-expanded', 'true');
  }

  L.move.chooser = { open: open, close: close, isOpen: isOpen };
})();
