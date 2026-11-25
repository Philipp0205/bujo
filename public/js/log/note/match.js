/*
 * The "looks like your note" row of the free-note review: the saved note a scan most likely is, with two choices, Update it (the default)
 * and Save as new. A view only: it moves the sheet values' id between that note and null, and the sheet's Save does the writing.
 * Needs ak-dom.js, copy.js, scan/copy.js and dates.js.
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};
  L.note = L.note || {};

  /** The sentence above the pills: a likely match, or the note an explicit rescan replaces. */
  function sentence(match) {
    var copy = L.copy.scan.note;
    var day = L.dates.dayHeading(match.date);
    return (match.explicit ? copy.matchRescan : copy.matchLooks)(match.title, day);
  }

  /** One pill of the two choices, pressed when it is the current one. */
  function pill(key, label, update, pick) {
    return h('button', {
      class: 'scan-kind', type: 'button', 'data-action': 'note-match-' + key, 'aria-pressed': update === (key === 'update') ? 'true' : 'false',
      onclick: function () { pick(key === 'update'); }
    }, label);
  }

  /**
   * Builds the row. values is the sheet's values object: id is the matched note's while Update is chosen, null for Save as new.
   * onChoice(update) lets the sheet follow (the day of the page, a kept day). Starts on Update.
   */
  function row(match, values, onChoice) {
    var copy = L.copy.scan.note;
    var group = h('div', { class: 'scan-kind-pills', role: 'group', 'aria-label': copy.matchGroup });
    function draw(update) {
      values.id = update ? match.id : null;
      group.replaceChildren(pill('update', copy.matchUpdate, update, pick), pill('new', copy.matchNew, update, pick));
    }
    function pick(update) {
      draw(update);
      onChoice(update);
    }
    draw(true);
    return h('div', { class: 'scan-kinds', 'data-testid': 'note-match' }, h('p', { class: 'scan-kind-note', 'data-testid': 'note-match-text' }, sentence(match)), group);
  }

  L.note.match = { row: row };
})();
