/*
 * The page-kind parts of the scan review: the place field of a row (a day on a calendar page, a month on a future page, the work or
 * private section on a month-task page) and the group headings. Views only: the rules live in scan/model.js. The kind itself is picked in the type picker (scan/picker/).
 * Needs ak-dom.js, copy.js, scan/copy.js, scan/model.js, dates.js, pages/model.js and glyph.js.
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};
  L.scan = L.scan || {};

  var FUTURE_MONTHS = 24;

  /** The months a future line can move to: the next two years from this month, plus the one the line holds. */
  function monthChoices(current) {
    var first = L.pages.model.monthOf(L.dates.todayIso());
    var months = [];
    for (var step = 0; step < FUTURE_MONTHS; step += 1) months.push(L.pages.model.shiftMonth(first, step));
    if (current && months.indexOf(current) < 0) months.push(current);
    return months.sort();
  }

  /** The month select of a future row. */
  function monthSelect(item, onChange) {
    var copy = L.copy.scan.review;
    var select = h('select', { class: 'scan-place scan-place-month', 'aria-label': copy.month, 'data-field': 'month' });
    function fill() {
      var choices = monthChoices(item.month);
      select.replaceChildren.apply(select, [h('option', { value: '' }, copy.noMonth)].concat(choices.map(function (month) {
        return h('option', { value: month }, copy.monthLabel(month));
      })));
      select.value = item.month || '';
    }
    select.addEventListener('change', function () {
      item.month = select.value || null;
      onChange();
    });
    return { node: select, show: fill };
  }

  /** The day input of a calendar row: a small number field. Each key press updates the day and the Apply button (a phone's number pad has no key that leaves the field); leaving it re-sorts the rows and asks the server again. */
  function dayInput(item, onChange, onType) {
    var copy = L.copy.scan.review;
    var input = h('input', { class: 'scan-place scan-place-day', type: 'text', inputmode: 'numeric', maxlength: 2, autocomplete: 'off', placeholder: copy.dayLabel, 'aria-label': copy.dayLabel, 'data-field': 'day', value: item.dayText });
    input.addEventListener('input', function () { L.scan.model.setDayText(item, input.value); onType(); });
    input.addEventListener('change', function () { onChange(); });
    return { node: input, show: function () { if (document.activeElement !== input) input.value = item.dayText; } };
  }

  /** The work or private toggle of a month-task row: two words, the chosen one in its pen loop. Tapping the chosen one again clears it. */
  function sectionToggle(item, onChange) {
    var copy = L.copy.scan.review.section;
    var buttons = ['work', 'private'].map(function (section) {
      return h('button', {
        class: 'scan-section', type: 'button', 'data-section': section, role: 'radio', onclick: function () {
          L.scan.model.setSection(item, item.section === section ? null : section);
          onChange();
        }
      }, L.scan.marker.pill('section:' + item.id + ':' + section), h('span', { class: 'scan-pick-text' }, copy[section]));
    });
    var node = h('div', { class: 'scan-sections', role: 'radiogroup', 'aria-label': copy.group }, buttons);
    return {
      node: node,
      show: function () {
        buttons.forEach(function (button) {
          button.setAttribute('aria-checked', button.getAttribute('data-section') === item.section ? 'true' : 'false');
        });
      }
    };
  }

  /** The place field of a row for a kind: a day on a calendar page, a month on a future page, the section on a month-task page, else nothing (node null). */
  function placeField(state, item, onChange, onType) {
    if (state.kind === 'calendar') return dayInput(item, onChange, onType);
    if (state.kind === 'future') return monthSelect(item, onChange);
    if (state.kind === 'month-task') return sectionToggle(item, onChange);
    return { node: null, show: function () {} };
  }

  /** The heading of a group of rows: a month of a future page or a day of a calendar page. */
  function groupHeading(state, key) {
    var copy = L.copy.scan.review;
    var text;
    if (state.kind === 'future') text = key ? copy.monthLabel(key) : copy.noMonth;
    else text = key ? L.dates.dayHeading(state.month + '-' + key) : copy.noDay;
    return h('h3', { class: 'scan-group', 'data-group': key }, text);
  }

  L.scan.kind = { placeField: placeField, groupHeading: groupHeading };
})();
