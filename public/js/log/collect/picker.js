/*
 * The collection picker: a sheet that files one log entry into a collection. It lists the existing collections (newest first) and a
 * "New collection" choice that asks for a title and a day. The move is one call (api.collect): the server appends the entry as a line,
 * leaves the trace on the old page and removes the entry. Nothing is written until a choice is made; dismissing changes nothing.
 * Needs ak-dom.js, nav/overlays.js, core.js, copy.js, dates.js, glyph.js, toast.js and api.js. options: entry, today, onMoved(collection).
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};
  L.collect = L.collect || {};

  var FORM_ID = 'collect-form';

  /** One row of the list: the glyph, the collection's title and its day under it. */
  function choice(action, label, hint, onPick, id) {
    return h('button', { class: 'migrate-choice', type: 'button', 'data-action': action, 'data-id': id || null, onclick: onPick },
      L.glyph.typeGlyph('collected'),
      h('span', { class: 'migrate-choice-text' }, h('span', { class: 'migrate-choice-label' }, label), h('span', { class: 'migrate-choice-hint' }, hint)));
  }

  /** The list view: "New collection" first, then every collection, or a quiet line while loading, on a failed load, or when there are none. */
  function listView(state, actions) {
    var words = L.copy.collect;
    if (state.status !== 'ready') return h('p', { class: 'migrate-empty', 'data-testid': 'collect-state', role: state.status === 'error' ? 'alert' : 'status' }, state.status === 'error' ? words.loadFailed : words.loading);
    var rows = state.collections.map(function (item) {
      return choice('pick-collection', item.title, L.dates.dayHeading(item.date), function () { actions.pick(item); }, item.id);
    });
    var first = choice('new-collection', words.newCollection, words.newHint, actions.openForm);
    var empty = state.collections.length ? null : h('p', { class: 'migrate-empty', 'data-testid': 'collect-none' }, words.none);
    return [h('div', { class: 'migrate-choices collect-list', role: 'group', 'aria-label': words.listLabel, 'data-testid': 'collect-list' }, [first].concat(rows)), empty];
  }

  /** The new-collection form: a title and a day (today to begin with). */
  function formView(state, onSubmit) {
    var words = L.copy.collect;
    state.title = h('input', { class: 'ak-input', type: 'text', maxlength: 200, autocomplete: 'off', 'data-field': 'collection-title', 'aria-label': words.titleLabel });
    state.date = h('input', { class: 'ak-input', type: 'date', required: true, 'data-field': 'collection-date', 'aria-label': words.dateLabel, value: state.today });
    return h('form', { class: 'detail-form', id: FORM_ID, novalidate: true, onsubmit: function (event) { event.preventDefault(); onSubmit(); } },
      h('label', { class: 'ak-field' }, h('span', { class: 'ak-label' }, words.titleLabel), state.title),
      h('label', { class: 'ak-field' }, h('span', { class: 'ak-label' }, words.dateLabel), state.date));
  }

  /** The dock for a view: Cancel on the list, Back and Move on the form. */
  function dockOf(state, actions) {
    var words = L.copy.collect;
    if (state.view === 'list') return [h('button', { class: 'ak-btn ak-btn-quiet', type: 'button', 'data-action': 'collect-cancel', onclick: actions.close }, words.cancel)];
    state.save = h('button', { class: 'ak-btn ak-btn-accent', type: 'submit', form: FORM_ID, 'data-action': 'collect-save' }, words.move);
    return [state.save, h('button', { class: 'ak-btn ak-btn-quiet', type: 'button', 'data-action': 'collect-back', onclick: actions.showList }, words.back)];
  }

  /** Redraws the scroll area and the dock for the current view. */
  function paint(parts, state, actions) {
    var content = state.view === 'list' ? listView(state, actions) : formView(state, actions.submit);
    parts.body.replaceChildren.apply(parts.body, [parts.slot].concat(content).filter(Boolean));
    parts.dock.replaceChildren.apply(parts.dock, dockOf(state, actions));
  }

  /** Opens the picker over the entry sheet's place. Returns the kit's handle, or null when another sheet is open. */
  function open(options) {
    var words = L.copy.collect;
    var state = { view: 'list', status: 'loading', collections: [], today: options.today, busy: false };
    var parts = { slot: h('div', { class: 'sheet-slot', 'aria-live': 'polite' }), body: h('div', { class: 'ak-sheet-scroll' }), dock: h('div', { class: 'ak-sheet-dock' }) };
    var sheet = null;
    var actions = {};

    /** The entry is filed: the sheet closes, the log reads again and a toast says where it went. */
    function moved(collection) {
      sheet.close();
      L.toast.show(words.moved(collection.title), 'ok');
      options.onMoved(collection);
    }

    /** Sends the move. A refusal (a full collection, a failed cancel in Nextcloud) shows its reason and keeps the picker open. */
    function send(target) {
      if (state.busy) return;
      state.busy = true;
      Bujo.say(parts.slot, '');
      L.api.collect(options.entry.id, target).then(moved, function (error) {
        state.busy = false;
        Bujo.say(parts.slot, error && error.message ? error.message : words.failed);
      });
    }

    actions.close = function () { sheet.close(); };
    actions.pick = function (item) { send({ collectionId: item.id }); };
    actions.openForm = function () { state.view = 'form'; paint(parts, state, actions); state.title.focus(); };
    actions.showList = function () { state.view = 'list'; paint(parts, state, actions); };
    actions.submit = function () {
      var title = state.title.value.trim();
      var message = title === '' ? words.titleRequired : state.date.value ? '' : words.dateRequired;
      Bujo.say(parts.slot, message);
      if (!message) send({ title: title, date: state.date.value });
    };

    var node = h('div', { class: 'ak-sheet sheet-entry sheet-migrate', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'collect-title', 'data-testid': 'collect-sheet' },
      h('div', { class: 'ak-sheet-head' }, h('div', { class: 'ak-grabber' }), h('h2', { class: 'sheet-title', id: 'collect-title' }, words.title),
        h('p', { class: 'sheet-sub', 'data-testid': 'collect-sub' }, options.entry.title)),
      parts.body, parts.dock);
    paint(parts, state, actions);
    sheet = BujoNav.overlays.showSheet(node, {});
    L.api.listNotes().then(function (collections) {
      state.status = 'ready';
      state.collections = collections;
      if (state.view === 'list') paint(parts, state, actions);
    }, function () {
      state.status = 'error';
      if (state.view === 'list') paint(parts, state, actions);
    });
    return sheet;
  }

  L.collect.picker = { open: open };
})();
