/*
 * The free-note sheet (mock 06 without Obsidian): one paper sheet to review a scanned note and to view or edit a saved one.
 * It edits title, day and markdown, saves through /api/entries, and copies the markdown. Dismissing writes nothing.
 * Needs ak-dom.js, ak-sheet.js, core.js, copy.js, dates.js, glyph.js, api.js and note/model.js.
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};
  L.note = L.note || {};

  var FORM_ID = 'note-form';
  var COPIED_MS = 2000;

  /** A labelled field of the sheet. The label wraps the control so a tap on it focuses the control. */
  function field(label, control) {
    return h('label', { class: 'ak-field' }, h('span', { class: 'ak-label' }, label), control);
  }

  /** The title input, the day input and the markdown textarea, filled from the values. */
  function controls(values) {
    var copy = L.copy.note;
    return {
      title: h('input', { class: 'ak-input', type: 'text', name: 'title', maxlength: 200, autocomplete: 'off', 'data-field': 'title', 'aria-label': copy.title, value: values.title }),
      date: h('input', { class: 'scan-date-input', type: 'date', name: 'date', required: true, 'data-field': 'date', 'aria-label': copy.date, value: values.date }),
      body: h('textarea', { class: 'ak-input note-body', name: 'body', spellcheck: 'false', 'data-field': 'body', 'aria-label': copy.body, value: values.body })
    };
  }

  /** The values to send, read from the controls. */
  function readValues(id, inputs) {
    return { id: id, title: inputs.title.value, date: inputs.date.value, body: inputs.body.value };
  }

  /** The day row: a mini page icon, the day, a hint, and the invisible date input over all of it. */
  function dayRow(inputs, hint) {
    var day = h('span', { class: 'scan-day', 'data-testid': 'note-day' }, L.dates.dayHeading(inputs.date.value));
    inputs.date.addEventListener('input', function () {
      if (inputs.date.value) day.textContent = L.dates.dayHeading(inputs.date.value);
    });
    return h('label', { class: 'scan-date' }, L.glyph.use('g-scan-page', { viewBox: '0 0 40 52', width: 40, height: 52 }),
      h('span', { class: 'scan-date-text' }, day, h('span', { class: 'scan-source' }, hint)), inputs.date);
  }

  /** The Copy button: copies the markdown as it is on screen and says "Copied" for a moment. */
  function copyButton(inputs) {
    var copy = L.copy.note;
    var button = h('button', { class: 'paper-link note-copy', type: 'button', 'data-action': 'copy-note', 'aria-live': 'polite' }, copy.copy);
    var timer = null;
    function say(text) {
      button.textContent = text;
      window.clearTimeout(timer);
      timer = window.setTimeout(function () { button.textContent = copy.copy; }, COPIED_MS);
    }
    button.addEventListener('click', function () {
      AppKit.copyText(inputs.body.value).then(function (ok) { say(ok ? copy.copied : copy.copyFailed); });
    });
    return button;
  }

  /** The head: grabber, title, a line under it, and Cancel when the note is not saved yet. */
  function head(options, onCancel) {
    var copy = L.copy.note;
    var scan = L.copy.scan.note;
    var cancel = options.mode === 'review'
      ? h('button', { class: 'note-cancel', type: 'button', 'data-action': 'note-cancel', onclick: onCancel }, scan.cancel)
      : null;
    // The kit's head captures the pointer for its swipe, which would swallow the click of a button inside it.
    if (cancel) cancel.addEventListener('pointerdown', function (event) { event.stopPropagation(); });
    return h('div', { class: 'ak-sheet-head' },
      h('div', { class: 'ak-grabber' }),
      h('h2', { class: 'sheet-title', id: 'note-title' }, options.mode === 'review' ? scan.reviewHeading : copy.savedHeading),
      h('p', { class: 'sheet-sub', 'data-testid': 'note-sub' }, options.mode === 'review' ? scan.reviewSub : copy.savedSub),
      cancel);
  }

  /** Sends the values: a POST for a scanned note, a PATCH for a saved one. */
  function send(values) {
    var body = L.note.model.payload(values);
    return values.id === null ? L.api.create(body) : L.api.update(values.id, body);
  }

  /** The words for a problem key of the model. */
  function messageFor(key) {
    var copy = L.copy.note;
    return { title: copy.titleRequired, date: copy.dateRequired, body: copy.bodyRequired }[key] || '';
  }

  /**
   * Opens the sheet. options.mode is 'review' (a scan, not saved yet) or 'saved'. options.values come from the model.
   * options.onSaved(entry) runs after a successful save.
   */
  function open(options) {
    var copy = L.copy.note;
    var inputs = controls(options.values);
    var slot = h('div', { class: 'sheet-slot', 'aria-live': 'polite' });
    var save = h('button', { class: 'ak-btn ak-btn-accent', type: 'submit', form: FORM_ID, 'data-action': 'save-note' },
      options.mode === 'review' ? L.copy.scan.note.save : copy.save);
    var sheet = null;

    function busy(on) {
      save.disabled = on;
      if (on) save.textContent = copy.saving;
      else save.textContent = options.mode === 'review' ? L.copy.scan.note.save : copy.save;
    }

    function submit() {
      var values = readValues(options.values.id, inputs);
      var key = L.note.model.problem(values);
      Bujo.say(slot, messageFor(key));
      if (key || save.disabled) return;
      busy(true);
      send(values).then(function (entry) {
        sheet.close();
        options.onSaved(entry);
      }, function (error) {
        busy(false);
        Bujo.say(slot, error && error.message ? error.message : copy.saveFailed);
      });
    }

    var form = h('form', { class: 'detail-form', id: FORM_ID, novalidate: true, onsubmit: function (event) {
      event.preventDefault();
      submit();
    } },
      dayRow(inputs, copy.dayHint), field(copy.title, inputs.title), field(copy.body, inputs.body), copyButton(inputs));
    var node = h('div', { class: 'ak-sheet sheet-entry sheet-scan sheet-note', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'note-title', 'data-testid': 'note-sheet', 'data-mode': options.mode },
      head(options, function () { sheet.close(); }),
      h('div', { class: 'ak-sheet-scroll' }, slot, form),
      h('div', { class: 'ak-sheet-dock' }, save));
    sheet = AppKit.sheet.show(node, {});
    return sheet;
  }

  L.note.sheet = { open: open };
})();
