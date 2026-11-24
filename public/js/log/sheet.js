/*
 * The entry details sheet: a bottom sheet to change every field of a saved entry, see its sync state and retry a failed
 * sync. New entries are typed in the log (inline/), never here. Needs ak-dom.js, ak-sheet.js, nav/overlays.js,
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

  /** The six type buttons. Returns the node and a getter for the chosen type. onPick(type) runs on every tap. */
  function typeGrid(initial, onPick) {
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
      onPick(type);
    }
    var node = h('div', { class: 'ak-field' },
      h('span', { class: 'ak-label' }, L.copy.sheet.type),
      h('div', { class: 'type-grid', role: 'group', 'aria-label': L.copy.sheet.type }, buttons));
    return { node: node, value: function () { return chosen; } };
  }

  /** The important switch of the sheet: a * and the word, pressed while on. Returns the node and a getter of the chosen state. */
  function importantSwitch(initial) {
    var copy = L.copy.important;
    var on = initial === true;
    var button = h('button', {
      class: 'important-toggle', type: 'button', 'data-testid': 'sheet-important', 'aria-pressed': on ? 'true' : 'false',
      onclick: function () {
        on = !on;
        button.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    }, h('span', { class: 'important-toggle-star', 'aria-hidden': 'true' }, '*'), h('span', { class: 'important-toggle-label' }, copy.toggle),
    h('span', { class: 'important-toggle-hint' }, copy.hint));
    return { node: h('div', { class: 'ak-field' }, button), value: function () { return on; } };
  }

  /** The read-only sync line: the state in words and its ink dot. */
  function syncLine(sync) {
    return h('div', { class: 'ak-field' },
      h('span', { class: 'ak-label' }, L.copy.sheet.sync),
      h('div', { class: 'sync-line', 'data-testid': 'sync-line' },
        L.glyph.syncMark(sync),
        h('span', null, L.copy.sync[sync])));
  }

  /** Under the sync line of a failed entry: the short reason and the Retry sync button. Null for any other state. */
  function syncFailure(entry, onRetry) {
    if (!entry || entry.sync !== 'error') return null;
    return h('div', { class: 'ak-field sync-failure' },
      h('p', { class: 'sync-reason', 'data-testid': 'sync-reason' }, entry.syncError || L.copy.sheet.syncErrorFallback),
      h('button', { class: 'paper-link', type: 'button', 'data-action': 'retry-sync', onclick: onRetry }, L.copy.sheet.retrySync));
  }

  /** The sync block for a type: the sync line and any retry block, or nothing for a note (notes never sync). */
  function syncBlock(values, type, onRetry) {
    if (!L.days.showsSync(type)) return [];
    return [syncLine(values.sync), syncFailure(values, onRetry)];
  }

  /** A holder for the sync block that is refilled when the type changes. */
  function syncSlot(values, onRetry) {
    var node = h('div', { class: 'sync-slot' });
    function show(type) {
      node.textContent = '';
      syncBlock(values, type, onRetry).forEach(function (part) { if (part) node.appendChild(part); });
    }
    show(values.type);
    return { node: node, show: show };
  }

  /** The inputs of the form. Title is one line, capped like the server caps it. Tags are one field, words separated by spaces. */
  function inputs(values) {
    return {
      title: h('input', { class: 'ak-input', type: 'text', name: 'title', maxlength: 200, autocomplete: 'off', value: values.title }),
      tag: h('input', { class: 'ak-input', type: 'text', name: 'tag', maxlength: 500, autocomplete: 'off', value: L.tags.join(values.tags || []) }),
      date: h('input', { class: 'ak-input', type: 'date', name: 'date', required: true, value: values.date }),
      time: h('input', { class: 'ak-input', type: 'time', name: 'time', value: values.time || '' })
    };
  }

  /** The values to send, from the controls. An empty tag list or a blank time clears it on an edit. A field left as shown keeps its tags. */
  function readValues(controls, grid, values, star) {
    var horizon = values.horizon || 'day';
    var date = controls.date.value;
    // A new day on a month-task or future item moves it to the daily log. A month-only event stays a task until it has a day.
    if (!L.days.hasDay(horizon) && date && date !== values.date) horizon = 'day';
    var type = grid.value();
    if (type === 'event' && !L.days.hasDay(horizon)) type = 'task';
    var next = {
      date: date,
      type: type,
      title: controls.title.value.trim(),
      tags: L.tags.fromField(controls.tag.value, values.tags || []),
      time: controls.time.value || null
    };
    if (horizon !== (values.horizon || 'day')) next.horizon = horizon;
    // Only a changed flag is sent, so an untouched save never unflags a remote priority. An explicit off sends false.
    if (star.value() !== (values.important === true)) next.important = star.value();
    return next;
  }

  /** The message to show for values that cannot be sent, or '' when they are fine. */
  function problem(values) {
    if (!values.title) return L.copy.errors.titleRequired;
    if (!values.date) return L.copy.errors.dateRequired;
    return '';
  }

  /** The form: type grid, title, tag, date, time and the sync block (not for notes). Returns the node and a reader of the values. */
  function buildForm(values, onSubmit, onRetry) {
    var sync = syncSlot(values, onRetry);
    var grid = typeGrid(values.type, sync.show);
    var controls = inputs(values);
    var star = importantSwitch(values.important);
    var node = h('form', { class: 'detail-form', id: FORM_ID, novalidate: true, onsubmit: function (event) {
      event.preventDefault();
      onSubmit();
    } },
      grid.node,
      star.node,
      field(L.copy.sheet.title, controls.title),
      field(L.copy.sheet.tag, controls.tag),
      field(L.copy.sheet.date, controls.date),
      field(L.copy.sheet.time, controls.time),
      sync.node);
    return { node: node, controls: controls, read: function () { return readValues(controls, grid, values, star); } };
  }

  /** The head of the sheet: grabber, title and the date under it. */
  function sheetHead(subtitle) {
    return h('div', { class: 'ak-sheet-head' },
      h('div', { class: 'ak-grabber' }),
      h('h2', { class: 'sheet-title', id: 'entry-title' }, L.copy.sheet.editTitle),
      subtitle);
  }

  /** Opens the details sheet of a saved entry. New entries are typed in the log, never here. */
  function open(options) {
    var entry = options.entry;
    var values = entry;
    var subtitle = h('p', { class: 'sheet-sub', 'data-testid': 'sheet-date' }, L.dates.dayHeading(values.date));
    var slot = h('div', { class: 'sheet-slot', 'aria-live': 'polite' });
    var save = h('button', { class: 'ak-btn ak-btn-accent', type: 'submit', form: FORM_ID, 'data-action': 'save' }, L.copy.sheet.save);
    var sheet = null;
    var form = buildForm(values, submit, retry);

    function showError(message) {
      Bujo.say(slot, message);
    }

    function busy(on) {
      save.disabled = on;
      save.textContent = on ? L.copy.sheet.saving : L.copy.sheet.save;
    }

    /** Retry sync: the server queues the push again, the sheet closes and the log shows the pending dot. */
    function retry() {
      showError('');
      L.api.retrySync(entry.id).then(function (updated) {
        sheet.close();
        options.onSaved(updated);
      }, function (error) {
        showError(error && error.message ? error.message : L.copy.errors.retryFailed);
      });
    }

    function submit() {
      var next = form.read();
      var message = problem(next);
      showError(message);
      if (message || save.disabled) return;
      busy(true);
      L.outbox.save.update(entry, next).then(function (saved) {
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
      sheetHead(subtitle),
      h('div', { class: 'ak-sheet-scroll' }, slot, form.node),
      h('div', { class: 'ak-sheet-dock' }, save));
    sheet = BujoNav.overlays.showSheet(node);
    return sheet;
  }

  L.sheet = { open: open };
})();
