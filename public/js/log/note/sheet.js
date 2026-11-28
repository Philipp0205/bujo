/*
 * The free-note sheet (mock 06 without Obsidian): one paper sheet to review a scanned note and to view or edit a saved one.
 * It edits title, day and markdown, saves through /api/entries (and stores the scan photo with the note), and copies the markdown.
 * Dismissing writes nothing. Needs ak-dom.js, ak-sheet.js, nav/overlays.js, core.js, copy.js, dates.js, glyph.js, api.js, note/model.js, note/photo.js, note/remove.js and note/editor/view.js (and note/match.js for a scan that looks like a saved note).
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

  /** The markdown editor: a saved note opens as rendered preview, a scan or a new note opens in edit mode. */
  function editorView(inputs, options) {
    return L.note.editor.view.create({ area: inputs.body, field: field(L.copy.note.body, inputs.body), editing: options.mode !== 'saved' });
  }

  /** The values to send, read from the controls. noteKind is the collection kind a scan was saved as (options.noteKind(), set by the type picker), else left out. */
  function readValues(id, inputs, options) {
    var values = { id: id, title: inputs.title.value, date: inputs.date.value, body: inputs.body.value };
    if (options.noteKind) values.noteKind = options.noteKind();
    return values;
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

  /** The head: grabber, title, a line under it, and Cancel when the note is not saved yet. mode is 'review' (a scan), 'new' (typed by hand) or 'saved'. */
  function head(options, onCancel) {
    var copy = L.copy.note;
    var scan = L.copy.scan.note;
    var cancel = options.mode === 'review'
      ? h('button', { class: 'note-cancel', type: 'button', 'data-action': 'note-cancel', onclick: onCancel }, scan.cancel)
      : null;
    var words = { review: [scan.reviewHeading, scan.reviewSub], new: [copy.newHeading, copy.newSub], saved: [copy.savedHeading, copy.savedSub] }[options.mode];
    // The kit's head captures the pointer for its swipe, which would swallow the click of a button inside it.
    if (cancel) cancel.addEventListener('pointerdown', function (event) { event.stopPropagation(); });
    return h('div', { class: 'ak-sheet-head' },
      h('div', { class: 'ak-grabber' }),
      h('h2', { class: 'sheet-title', id: 'note-title' }, words[0]),
      h('p', { class: 'sheet-sub', 'data-testid': 'note-sub' }, words[1]),
      cancel);
  }

  /**
   * Sends the values: a POST for a scanned note, a PATCH for a saved one. A photo not stored yet goes up after the note, once.
   * The new note's id is kept in options.values, so a retry after a failed photo upload edits that note and adds no second one.
   */
  function send(values, pending, options) {
    var body = L.note.model.payload(values);
    var saved = values.id === null ? L.api.create(body) : L.api.update(values.id, body);
    return saved.then(function (entry) {
      options.values.id = entry.id;
      if (!pending.blob) return entry;
      return L.api.uploadPhoto(entry.id, pending.blob).then(function (withPhoto) {
        pending.blob = null;
        return withPhoto;
      }, function () {
        throw new Error(L.copy.note.photoFailed);
      });
    });
  }

  /** The words for a problem key of the model. */
  function messageFor(key) {
    var copy = L.copy.note;
    return { title: copy.titleRequired, date: copy.dateRequired, body: copy.bodyRequired }[key] || '';
  }

  /** The photo field of the sheet: the one waiting to be saved, else the stored one, else nothing. */
  function photoField(options) {
    var values = options.values;
    if (options.photo) return L.note.photo.field(options.photo.url);
    if (values.id !== null && values.hasPhoto) return L.note.photo.field(L.api.photoUrl(values.id));
    return null;
  }

  /** The Scan again button of a saved note: closes the sheet and starts the note camera for it, through options.onRescan(values) or, off the log (the Notes tab), by opening the log's scan. */
  function rescanButton(options, close) {
    if (options.mode !== 'saved' || (!options.onRescan && !(window.BujoNav && BujoNav.router))) return null;
    var rescan = options.onRescan || function (values) { BujoNav.router.go('log', { scan: true, replaceNote: values }); };
    return h('button', {
      class: 'paper-link note-rescan', type: 'button', 'data-action': 'rescan-note',
      onclick: function () { close(); rescan(options.values); }
    }, L.copy.note.scanAgain);
  }

  /**
   * The Delete note link of a saved note (a 44px paper link): asks first, then removes the note and its photo on the server and closes the sheet.
   * The host hears of it through options.onDeleted(values), else options.onSaved(values), which every host already uses to read its list again.
   */
  function deleteButton(options, close) {
    if (options.mode !== 'saved' || options.values.id === null) return null;
    var values = options.values;
    function remove() {
      return L.api.remove(values.id).then(function () {
        close();
        (options.onDeleted || options.onSaved)(values);
      });
    }
    return h('button', {
      class: 'paper-link note-delete', type: 'button', 'data-action': 'delete-note', 'data-testid': 'note-delete',
      onclick: function () { L.note.remove.open({ title: values.title, onConfirm: remove }); }
    }, L.copy.note.delete);
  }

  /** The row that offers the saved note a scan looks like, or null. A match that keeps its day puts that day in the form while Update is chosen. */
  function matchRow(options, inputs) {
    var match = options.match;
    if (!match) return null;
    var scanned = inputs.date.value;
    function follow(update) {
      if (!match.keepDate) return;
      inputs.date.value = update ? match.date : scanned;
      inputs.date.dispatchEvent(new Event('input'));
    }
    var node = L.note.match.row(match, options.values, follow);
    follow(true);
    return node;
  }

  /**
   * Opens the sheet. options.mode is 'review' (a scan, not saved yet), 'new' (a note typed by hand, not saved yet) or 'saved'. options.values come from the model.
   * options.photo is { blob, url } for the page photo of a scan, saved with the note. options.onSaved(entry) runs after a successful save.
   * options.match is the saved note a scan looks like ({ id, title, date, keepDate, explicit }): the review offers to update it. options.onRescan(values)
   * adds Scan again to a saved note. options.typeRow is the type picker node of a scan, shown above the form; options.noteKind() (optional) says
   * the collection kind (list, tracker, project, misc) the note is saved with.
   * options.onClosed() (optional) runs when the sheet closes, however it closes. options.onDeleted(values) (optional) runs after a saved note is deleted (default: onSaved). The returned handle has values(): the form as it is now.
   */
  function open(options) {
    var copy = L.copy.note;
    var inputs = controls(options.values);
    var pending = { blob: options.photo ? options.photo.blob : null };
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
      var values = readValues(options.values.id, inputs, options);
      var key = L.note.model.problem(values);
      Bujo.say(slot, messageFor(key));
      if (key || save.disabled) return;
      busy(true);
      send(values, pending, options).then(function (entry) {
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
      dayRow(inputs, copy.dayHint), field(copy.title, inputs.title), editorView(inputs, options), photoField(options), copyButton(inputs),
      rescanButton(options, function () { sheet.close(); }), deleteButton(options, function () { sheet.close(); }));
    var offer = matchRow(options, inputs);
    var node = h('div', { class: 'ak-sheet sheet-entry sheet-scan sheet-note', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'note-title', 'data-testid': 'note-sheet', 'data-mode': options.mode },
      head(options, function () { sheet.close(); }),
      h('div', { class: 'ak-sheet-scroll' }, slot, options.typeRow, offer, form),
      h('div', { class: 'ak-sheet-dock' }, save));
    sheet = BujoNav.overlays.showSheet(node, { onClose: options.onClosed });
    if (sheet) {
      sheet.values = function () { return readValues(options.values.id, inputs, options); };
      sheet.say = function (message) { Bujo.say(slot, message); };
    }
    return sheet;
  }

  L.note.sheet = { open: open };
})();
