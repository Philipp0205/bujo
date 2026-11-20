/*
 * The entry sheet: one bottom sheet for creating and editing an entry. Needs ak-dom.js, ak-sheet.js,
 * copy.js, dates.js, glyph.js and api.js. The caller gets onSaved(entry) after a successful save.
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};
  var FORM_ID = 'entry-form';

  /** A labelled field of the sheet. The label wraps the control so a tap on it focuses the control. */
  function field(label, control) {
    return h('label', { class: 'ak-field' }, h('span', { class: 'ak-label' }, label), control);
  }

  /** The six type buttons. Returns the node and a getter for the chosen type. */
  function typeGrid(initial) {
    var chosen = initial;
    var buttons = L.glyph.TYPES.map(function (type) {
      return h('button', {
        class: 'type-btn',
        type: 'button',
        'data-type': type,
        'aria-pressed': type === chosen ? 'true' : 'false',
        onclick: function () { pick(type); }
      }, L.glyph.typeGlyph(type), h('small', null, L.copy.typeLabels[type]));
    });
    function pick(type) {
      chosen = type;
      buttons.forEach(function (button) {
        button.setAttribute('aria-pressed', button.getAttribute('data-type') === type ? 'true' : 'false');
      });
    }
    var node = h('div', { class: 'ak-field' },
      h('span', { class: 'ak-label' }, L.copy.sheet.type),
      h('div', { class: 'type-grid', role: 'group', 'aria-label': L.copy.sheet.type }, buttons));
    return { node: node, value: function () { return chosen; } };
  }

  /** The read-only sync line: the state in words and its ink dot. */
  function syncLine(sync) {
    return h('div', { class: 'ak-field' },
      h('span', { class: 'ak-label' }, L.copy.sheet.sync),
      h('div', { class: 'sync-line', 'data-testid': 'sync-line' },
        L.glyph.syncMark(sync),
        h('span', null, L.copy.sync[sync])));
  }

  /** The starting values: the entry to edit, or a new task on the given day. */
  function initialValues(entry, today) {
    if (entry) return entry;
    return { date: today, type: 'task', title: '', tag: null, time: null, sync: 'local' };
  }

  /** The text inputs and their reader. Title is one line, capped like the server caps it. */
  function inputs(values) {
    return {
      title: h('input', { class: 'ak-input', type: 'text', name: 'title', maxlength: 200, autocomplete: 'off', value: values.title }),
      tag: h('input', { class: 'ak-input', type: 'text', name: 'tag', maxlength: 40, autocomplete: 'off', value: values.tag || '' }),
      date: h('input', { class: 'ak-input', type: 'date', name: 'date', required: true, value: values.date }),
      time: h('input', { class: 'ak-input', type: 'time', name: 'time', value: values.time || '' })
    };
  }

  /** The values to send, from the controls. A blank tag or time is sent as null so an edit can clear it. */
  function readValues(controls, grid) {
    return {
      date: controls.date.value,
      type: grid.value(),
      title: controls.title.value.trim(),
      tag: controls.tag.value.trim() || null,
      time: controls.time.value || null
    };
  }

  /** The message to show for values that cannot be sent, or '' when they are fine. */
  function problem(values) {
    if (!values.title) return L.copy.errors.titleRequired;
    if (!values.date) return L.copy.errors.dateRequired;
    return '';
  }

  /** The form: type grid, title, tag, date, time and the sync line. Returns the node and a reader of the values. */
  function buildForm(values, onSubmit) {
    var grid = typeGrid(values.type);
    var controls = inputs(values);
    var node = h('form', { class: 'detail-form', id: FORM_ID, novalidate: true, onsubmit: function (event) {
      event.preventDefault();
      onSubmit();
    } },
      grid.node,
      field(L.copy.sheet.title, controls.title),
      field(L.copy.sheet.tag, controls.tag),
      field(L.copy.sheet.date, controls.date),
      field(L.copy.sheet.time, controls.time),
      syncLine(values.sync));
    return { node: node, controls: controls, read: function () { return readValues(controls, grid); } };
  }

  /** The head of the sheet: grabber, title and the date under it. */
  function sheetHead(entry, subtitle) {
    return h('div', { class: 'ak-sheet-head' },
      h('div', { class: 'ak-grabber' }),
      h('h2', { class: 'sheet-title', id: 'entry-title' }, entry ? L.copy.sheet.editTitle : L.copy.sheet.createTitle),
      subtitle);
  }

  /** Sends the values: a PATCH for an existing entry, a POST for a new one. */
  function send(entry, values) {
    return entry ? L.api.update(entry.id, values) : L.api.create(values);
  }

  /** Opens the sheet. entry is null to create. today is the day a new entry starts on. */
  function open(options) {
    var entry = options.entry;
    var values = initialValues(entry, options.today);
    var subtitle = h('p', { class: 'sheet-sub', 'data-testid': 'sheet-date' }, L.dates.dayHeading(values.date));
    var slot = h('div', { class: 'sheet-slot', 'aria-live': 'polite' });
    var save = h('button', { class: 'ak-btn ak-btn-accent', type: 'submit', form: FORM_ID, 'data-action': 'save' }, L.copy.sheet.save);
    var sheet = null;
    var form = buildForm(values, submit);

    function showError(message) {
      Bujo.say(slot, message);
    }

    function busy(on) {
      save.disabled = on;
      save.textContent = on ? L.copy.sheet.saving : L.copy.sheet.save;
    }

    function submit() {
      var next = form.read();
      var message = problem(next);
      showError(message);
      if (message || save.disabled) return;
      busy(true);
      send(entry, next).then(function (saved) {
        sheet.close();
        options.onSaved(saved);
      }, function (error) {
        busy(false);
        showError(error && error.message ? error.message : L.copy.errors.saveFailed);
      });
    }

    form.controls.date.addEventListener('input', function () {
      if (form.controls.date.value) subtitle.textContent = L.dates.dayHeading(form.controls.date.value);
    });

    var node = h('div', { class: 'ak-sheet sheet-entry', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'entry-title' },
      sheetHead(entry, subtitle),
      h('div', { class: 'ak-sheet-scroll' }, slot, form.node),
      h('div', { class: 'ak-sheet-dock' }, save));
    sheet = AppKit.sheet.show(node, { focus: entry ? null : form.controls.title });
    return sheet;
  }

  L.sheet = { open: open };
})();
