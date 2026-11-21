/*
 * The inline editor: the one line of the rapid log that is being typed, and what happens to it (save, drop, next line).
 * Application logic only. The nodes come from row.js and bar.js, the page is drawn by the host (main.js).
 * Needs model.js, row.js, pop.js, bar.js, viewport.js, api.js, copy.js.
 *
 * host: today(), draw() renders the page, upsert(entry) keeps the state in step with a saved entry,
 *       rowFor(entry) builds a saved row, openSheet(entry) opens the details sheet.
 * The page is always redrawn through paint(), which puts the line being typed back with its draft, caret and focus.
 * At most one line is active. Blur and Escape save a non-empty line and drop an empty one. Enter saves and starts the next.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.inline = L.inline || {};

  var model = null;
  var bar = null;
  var host = null;
  var active = null;
  var muted = false;
  var pressed = false;
  var blurred = null;

  /** The text input of the active line, or null when no line is drawn. */
  function titleInput() {
    return document.querySelector('.paper-edit-input');
  }

  /** The editing line node (row plus error), or null. */
  function lineNode() {
    return document.querySelector('.paper-line');
  }

  /** Runs fn with blur handling off: moving or removing the focused input fires a blur that the person did not cause. */
  function quietly(fn) {
    var before = muted;
    muted = true;
    try { fn(); } finally { muted = before; }
  }

  /** Puts the caret at the end of the title input and focuses it, so the keyboard stays up. */
  function focusTitle() {
    var input = titleInput();
    if (!input) return;
    quietly(function () {
      input.focus({ preventScroll: true });
      input.setSelectionRange(input.value.length, input.value.length);
    });
  }

  /** After any draw: show or hide the bar, and put the draft, the caret and the focus back into the fresh input. */
  function sync(caret) {
    document.documentElement.classList.toggle('is-editing', !!active);
    if (!active) { bar.hide(); return; }
    bar.show(active);
    var input = titleInput();
    if (!input) return;
    input.value = active.title;
    if (!document.activeElement || !document.activeElement.closest('.inline-bar')) focusTitle();
    if (caret) input.setSelectionRange(caret.start, caret.end);
    L.inline.viewport.reveal(lineNode());
  }

  /** The caret of the title being typed, so a redraw in the middle of a word does not move it. */
  function caretOf() {
    var input = titleInput();
    return input && input === document.activeElement ? { start: input.selectionStart, end: input.selectionEnd } : null;
  }

  /** Redraws the page and puts the line being typed back, focused, without the swap counting as a blur. */
  function paint() {
    var caret = caretOf();
    quietly(function () { host.draw(); });
    sync(caret);
  }

  /** Makes a line the active one and draws it focused. Runs inside the tap that asked for it, so the keyboard opens. */
  function start(line) {
    active = line;
    quietly(function () { bar.closePop(); });
    paint();
  }

  /** Leaves editing: no active line, bar hidden, page drawn from the state. */
  function end() {
    active = null;
    paint();
  }

  /** An empty line is not saved: a new one is dropped, an existing one keeps its saved title. Nothing is sent or deleted. */
  function abandon(line, next) {
    if (next) start(model.blank(host.today()));
    else end();
    return { ok: true, entry: line.original };
  }

  /** The text for a failed save: the server's own short reason when it sent one, else the copy line. */
  function failure(error) {
    return error && error.status && error.message ? error.message : L.copy.errors.lineFailed;
  }

  /** Sends a line: POST for a new one, PATCH with only the changes for an existing one. */
  function send(line, body) {
    return line.isNew ? L.api.create(body) : L.api.update(line.id, body);
  }

  /** Locks the title while a save is in flight, without closing the keyboard. */
  function lock(on) {
    var input = titleInput();
    if (input) input.readOnly = on;
  }

  /** A saved new line on its own day: the saved row goes in above, the same input stays and starts the next line. */
  function continueHere(line, entry) {
    var node = lineNode();
    node.before(host.rowFor(entry));
    active = model.blank(line.home);
    quietly(function () { bar.closePop(); });
    titleInput().value = '';
    L.inline.row.update(active);
    bar.show(active);
    L.inline.viewport.reveal(node);
  }

  /** What follows a good save: end, or the next line (in place when the saved row landed in the same day). */
  function saved(line, entry, next) {
    if (!next) end();
    else if (line.isNew && entry.date === line.home && lineNode()) continueHere(line, entry);
    else start(model.blank(host.today()));
  }

  /** A failed save keeps the line open with its draft and a short error. */
  function failed(line, error) {
    line.error = failure(error);
    L.inline.row.update(line);
    focusTitle();
  }

  /** Sends the changes of a line. Resolves { ok, entry }. */
  function persist(line, body, next) {
    lock(true);
    line.saving = send(line, body).then(function (entry) {
      line.saving = null;
      lock(false);
      host.upsert(entry);
      saved(line, entry, next);
      return { ok: true, entry: entry };
    }, function (error) {
      line.saving = null;
      lock(false);
      failed(line, error);
      return { ok: false, entry: null };
    });
    return line.saving;
  }

  /** Saves the active line (or drops or cancels it when the title is empty). next starts a fresh line after. */
  function commit(next) {
    var line = active;
    if (!line) return Promise.resolve({ ok: true, entry: null });
    if (line.saving) return line.saving;
    if (!model.hasTitle(line)) return Promise.resolve(abandon(line, next));
    var body = model.changes(line);
    if (!line.isNew && Object.keys(body).length === 0) return Promise.resolve(abandon(line, next));
    return persist(line, body, next);
  }

  /** Runs make once the active line is saved or dropped. With no active line it runs at once, inside the tap. */
  function settle(make) {
    if (!active) { make(); return; }
    commit(false).then(function (result) { if (result.ok) make(); });
  }

  /** The "+ Add entry" tap and the empty space: a new line, or the next one when a line is already being typed. */
  function addLine() {
    if (!active) { start(model.blank(host.today())); return; }
    if (active.saving) { active.saving.then(function (result) { if (result.ok) start(model.blank(host.today())); }); return; }
    if (active.isNew && !model.hasTitle(active)) { focusTitle(); return; }
    commit(true);
  }

  /** A tap on a saved row: type in its title, after any other line is settled. */
  function editEntry(entry) {
    settle(function () { start(model.fromEntry(entry)); });
  }

  /** Saves the line, then opens the details sheet of the saved entry. */
  function details() {
    commit(false).then(function (result) {
      if (result.ok && result.entry) host.openSheet(result.entry);
    });
  }

  /** Every keystroke lands in the draft, so a redraw never loses it. A shown error goes away. */
  function typed(value) {
    active.title = value;
    if (!active.error) return;
    active.error = '';
    L.inline.row.update(active);
  }

  /** Closes the bar popover and gives the focus back to the title. */
  function closePop() {
    quietly(function () { bar.closePop(); });
    focusTitle();
  }

  /** The callbacks the popovers use. Each updates the line and the pills. A chosen value closes the popover. */
  function choices() {
    function set(key, value, close) {
      active[key] = value;
      L.inline.row.update(active);
      if (close) closePop();
    }
    return {
      type: function (type) { set('type', type, true); },
      tag: function (text) { set('tag', text.trim() || null, false); },
      date: function (iso) { if (iso) set('date', iso, true); },
      time: function (hhmm) { set('time', hhmm || null, true); },
      close: closePop
    };
  }

  /** A tap on a bar key: open its popover, or close it when it is already open. The tag field takes focus to type in. */
  function toggle(kind) {
    if (!active) return;
    if (bar.popKind() === kind) { closePop(); return; }
    bar.openPop(kind, active, choices());
    if (kind === 'tag') bar.popInput().focus();
  }

  /** Enter saves a non-empty line and starts the next. Backspace on an empty new line removes it. */
  function onTitleKey(event) {
    if (active.saving) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      if (model.hasTitle(active)) commit(true);
    } else if (event.key === 'Backspace' && active.isNew && event.target.value === '') {
      event.preventDefault();
      end();
    }
  }

  /** Escape closes an open popover first, otherwise it ends the edit like a blur does. Other keys go to the title. */
  function onKeyDown(event) {
    if (!active || event.isComposing) return;
    if (event.key === 'Escape') {
      if (bar.popOpen()) closePop();
      else commit(false);
    } else if (event.target === titleInput()) {
      onTitleKey(event);
    }
  }

  /** True for a node inside the editing zone: the line, the bar and its popover. */
  function inZone(node) {
    return !!(node && node.closest && node.closest('[data-edit-zone]'));
  }

  /** Ends the edit of a line whose focus left, once the press that took it is over (so the tap still reaches its target). */
  function releaseBlur() {
    pressed = false;
    var line = blurred;
    blurred = null;
    if (line && active === line && !line.saving && !inZone(document.activeElement)) commit(false);
  }

  /** Focus left the editing zone (title, bar, popover): that ends the edit like Escape does. */
  function onFocusOut(event) {
    if (!active || muted || inZone(event.relatedTarget) || !inZone(event.target)) return;
    if (pressed) {
      blurred = active;
      window.setTimeout(releaseBlur, 400);
    } else {
      commit(false);
    }
  }

  /** A press inside the editing zone must not move focus off the title. A press outside an open popover only closes it. */
  function onMouseDown(event) {
    if (!active) return;
    pressed = true;
    var target = event.target;
    if (bar.popOpen() && !target.closest('.inline-pop, .inline-bar')) closePop();
    if (inZone(target) && target.tagName !== 'INPUT') event.preventDefault();
  }

  /** Wires the editor to its host: the bar, the key and focus listeners, and the keyboard tracking. */
  function init(options) {
    host = options;
    model = L.inline.model;
    bar = L.inline.bar;
    bar.mount({ toggle: toggle, details: details });
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('mouseup', function () { window.setTimeout(releaseBlur, 0); }, true);
    L.inline.viewport.follow(function () {
      bar.place();
      if (active && lineNode()) L.inline.viewport.reveal(lineNode());
    });
  }

  /** Whether a line is being typed. The page leaves its rows alone while this is true. */
  function isEditing() {
    return active !== null;
  }

  L.inline.editor = {
    init: init, paint: paint, addLine: addLine, editEntry: editEntry, settle: settle, typed: typed,
    isEditing: isEditing, line: function () { return active; }
  };
})();
