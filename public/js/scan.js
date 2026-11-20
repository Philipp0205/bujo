/*
 * bujo scan screen. Plain JS, no build step. Needs core.js (Bujo.request, Bujo.upload) and ak-dom.js (AppKit.h).
 *
 * Flow: pick or take a photo, upload it, review one card per line, accept. Nothing is written until Accept.
 * The photo is read into this page for the preview and sent once. The server keeps no copy of it.
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var app = document.getElementById('app');

  var MAX_BYTES = 15 * 1024 * 1024;
  var SUMMARY_MAX = 200;
  var TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
  var SYMBOLS = [
    ['\u2022', '\u2022 Task'],
    ['x', 'x Done'],
    ['>', '> Migrated'],
    ['<', '< Scheduled'],
    ['\u25cb', '\u25cb Event'],
    ['\u2013', '\u2013 Note'],
    ['none', 'No symbol']
  ];
  var ACTION_LABELS = {
    create: 'Add as a new task',
    complete: 'Mark the task done',
    keep: 'Keep the task as it is',
    schedule: 'Set a due date',
    ignore: 'Not synced'
  };

  var state = {
    stage: 'pick', // pick | busy | review | applying | done
    preview: null,
    fileName: '',
    error: null,
    draft: null,
    items: [],
    pool: [],
    results: null
  };

  /* ---------- helpers ---------- */

  function actionFor(symbol, hasMatch) {
    if (symbol === 'x') return 'complete';
    if (symbol === '\u2022' || symbol === '>') return hasMatch ? 'keep' : 'create';
    if (symbol === '<') return 'schedule';
    return 'ignore';
  }

  function isIsoDate(text) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text || '');
    if (!m) return false;
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
  }

  function formatDay(iso) {
    var p = iso.split('-').map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2])).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }

  function actionOf(item) {
    return actionFor(item.symbol, item.match !== null);
  }

  /** Why this item cannot be sent yet, or null. Only included items are checked. */
  function problem(item) {
    var action = actionOf(item);
    if (action === 'ignore') return null;
    if (action === 'complete' && !item.match) return 'choose the task to mark done';
    if (action === 'create' || (action === 'schedule' && !item.match)) {
      var text = item.text.trim();
      if (!text) return 'the text is empty';
      if (text.length > SUMMARY_MAX) return 'the text is longer than ' + SUMMARY_MAX + ' characters';
      if (/[\u0000-\u001f\u007f\u2028\u2029]/.test(text)) return 'the text must be one line';
    }
    if (action === 'schedule' && !isIsoDate(item.due)) return 'set a due date';
    return null;
  }

  function poolIndex(match) {
    if (!match) return -1;
    for (var i = 0; i < state.pool.length; i++) {
      if (state.pool[i].list === match.list && state.pool[i].uid === match.uid) return i;
    }
    return -1;
  }

  function addToPool(match) {
    if (poolIndex(match) < 0) state.pool.push({ list: match.list, uid: match.uid, summary: match.summary });
  }

  /* ---------- steps ---------- */

  function chooseFile(file) {
    state.error = null;
    if (!file) return;
    var type = file.type;
    if (!type && /\.hei[cf]$/i.test(file.name)) type = 'image/heic';
    if (TYPES.indexOf(type) < 0) {
      state.error = 'This file is not a JPEG, PNG, WebP or HEIC photo.';
      render();
      return;
    }
    if (file.size > MAX_BYTES) {
      state.error = 'The photo is too large (at most 15 MB).';
      render();
      return;
    }
    state.file = new Blob([file], { type: type });
    state.fileName = file.name || 'photo';
    state.preview = null;
    var reader = new FileReader();
    reader.onload = function () {
      state.preview = typeof reader.result === 'string' ? reader.result : null;
      render();
    };
    reader.onerror = function () { render(); };
    reader.readAsDataURL(file);
    render();
  }

  function startScan() {
    if (!state.file) return;
    state.error = null;
    state.stage = 'busy';
    render();
    Bujo.upload('/api/scan', state.file, { guarded: true }).then(function (body) {
      return Bujo.request('GET', '/api/backlog', undefined, { guarded: true }).catch(function () { return { tasks: [] }; }).then(function (backlog) {
        state.draft = body.draft;
        state.pool = (backlog.tasks || []).map(function (t) { return { list: t.list, uid: t.uid, summary: t.summary }; });
        state.items = body.draft.items.map(function (item) {
          item.candidates.forEach(addToPool);
          if (item.match) addToPool(item.match);
          return {
            id: item.id,
            detected: item.detected,
            confidence: item.confidence,
            symbol: item.symbol,
            ocrText: item.ocrText,
            text: item.text,
            list: item.list,
            match: item.match ? { list: item.match.list, uid: item.match.uid, score: item.match.score } : null,
            candidates: item.candidates,
            ambiguous: item.ambiguous,
            due: item.due || '',
            include: item.include,
            note: item.note,
            isDate: item.isDate
          };
        });
        state.stage = 'review';
        render();
      });
    }).catch(function (error) {
      state.stage = 'pick';
      state.error = error && error.message ? error.message : 'Could not read the page. Try again.';
      render();
    });
  }

  function accept() {
    var chosen = state.items.filter(function (item) { return item.include && actionOf(item) !== 'ignore'; });
    var body = {
      items: chosen.map(function (item) {
        var out = { id: item.id, symbol: item.symbol, text: item.text.trim(), list: item.list };
        if (item.match) out.match = { list: item.match.list, uid: item.match.uid };
        if (actionOf(item) === 'schedule') out.due = item.due;
        return out;
      })
    };
    state.error = null;
    state.stage = 'applying';
    render();
    Bujo.request('POST', '/api/scan/' + encodeURIComponent(state.draft.id) + '/apply', body, { guarded: true }).then(function (result) {
      state.results = result.results;
      state.stage = 'done';
      render();
    }).catch(function (error) {
      state.stage = 'review';
      state.error = error && error.message ? error.message : 'Could not save. Try again.';
      render();
    });
  }

  function reset() {
    state = { stage: 'pick', preview: null, fileName: '', error: null, draft: null, items: [], pool: [], results: null, file: null };
    render();
  }

  /* ---------- views ---------- */

  function header(title) {
    return h('div', { class: 'bj-head' },
      h('h1', { class: 'ak-large-title' }, title),
      h('a', { class: 'bj-link', href: '/backlog', 'data-nav': 'backlog' }, 'Backlog'));
  }

  function errorBanner() {
    return state.error
      ? h('div', { class: 'bj-slot' }, h('div', { class: 'ak-banner', role: 'alert', 'data-kind': 'error', 'data-testid': 'scan-error' }, state.error))
      : null;
  }

  function pickView() {
    var input = h('input', {
      type: 'file',
      id: 'photo-input',
      class: 'bj-file',
      accept: 'image/*',
      capture: 'environment',
      onchange: function () { chooseFile(input.files && input.files[0]); }
    });
    var picker = h('input', {
      type: 'file',
      id: 'photo-pick',
      class: 'bj-file',
      accept: 'image/jpeg,image/png,image/webp,image/heic,.heic',
      onchange: function () { chooseFile(picker.files && picker.files[0]); }
    });
    return h('div', null,
      header('Scan'),
      h('p', { class: 'bj-note' }, 'Take a photo of today\u2019s page, or choose one from your library. The photo is read once and not kept. Nothing is saved until you accept.'),
      errorBanner(),
      h('div', { class: 'bj-actions bj-pad' },
        h('label', { class: 'ak-btn ak-btn-accent', for: 'photo-input', 'data-action': 'take' }, 'Take photo'),
        h('label', { class: 'ak-btn ak-btn-secondary', for: 'photo-pick', 'data-action': 'choose' }, 'Choose photo'),
        input, picker),
      state.preview
        ? h('div', { class: 'bj-preview' }, h('img', { src: state.preview, alt: 'Preview of the page you chose', 'data-testid': 'preview' }))
        : null,
      state.file
        ? h('div', { class: 'bj-pad' }, h('button', { type: 'button', class: 'ak-btn ak-btn-accent', 'data-action': 'upload', onclick: startScan }, 'Read the page'))
        : null);
  }

  function busyView(text) {
    return h('div', null, header('Scan'),
      h('div', { class: 'bj-loading', 'aria-busy': 'true', 'data-state': 'busy' },
        h('p', { class: 'bj-note' }, text),
        [0, 1, 2].map(function () { return h('div', { class: 'ak-skeleton ak-skeleton-line', 'aria-hidden': 'true' }); })));
  }

  function matchSelect(item, redraw) {
    var options = [h('option', { value: 'none' }, 'No match')];
    var seen = {};
    item.candidates.forEach(function (c) {
      var i = poolIndex(c);
      if (i < 0 || seen[i]) return;
      seen[i] = true;
      options.push(h('option', { value: String(i) }, c.summary + ' (' + c.list + ', ' + Math.round(c.score * 100) + '%)'));
    });
    state.pool.forEach(function (t, i) {
      if (seen[i]) return;
      options.push(h('option', { value: String(i) }, t.summary + ' (' + t.list + ')'));
    });
    var select = h('select', { class: 'ak-input', id: 'match-' + item.id, 'data-field': 'match', onchange: function () {
      var pick = select.value === 'none' ? null : state.pool[Number(select.value)];
      item.match = pick ? { list: pick.list, uid: pick.uid, score: null } : null;
      redraw();
    } }, options);
    var at = poolIndex(item.match);
    select.value = at < 0 ? 'none' : String(at);
    return select;
  }

  function card(item, refresh) {
    var node = h('li', { class: 'ak-card bj-item', 'data-item': item.id });
    function redraw() {
      var fresh = card(item, refresh);
      node.replaceWith(fresh);
      refresh();
    }
    var action = actionOf(item);
    var ignored = action === 'ignore';

    var symbol = h('select', { class: 'ak-input', id: 'symbol-' + item.id, 'data-field': 'symbol', onchange: function () {
      var was = actionOf(item);
      item.symbol = symbol.value;
      var now = actionOf(item);
      if (now === 'ignore') item.include = false;
      else if (was === 'ignore') item.include = true;
      redraw();
    } }, SYMBOLS.map(function (s) { return h('option', { value: s[0] }, s[1]); }));
    symbol.value = item.symbol;

    var include = h('input', {
      type: 'checkbox',
      id: 'include-' + item.id,
      'data-field': 'include',
      checked: item.include && !ignored,
      disabled: ignored,
      onchange: function () { item.include = include.checked; redraw(); }
    });

    var fields = [];
    if (action === 'create' || (action === 'schedule' && !item.match)) {
      var text = h('input', { class: 'ak-input', id: 'text-' + item.id, type: 'text', maxlength: String(SUMMARY_MAX), value: item.text, 'data-field': 'text', oninput: function () {
        item.text = text.value;
        refresh();
      } });
      fields.push(h('div', { class: 'ak-field' }, h('label', { class: 'ak-label', for: 'text-' + item.id }, 'Task text'), text));
    }
    if (!ignored) {
      var matchLabel = action === 'complete' ? 'Task to mark done' : action === 'create' ? 'Is this an existing task?' : 'Matching open task';
      fields.push(h('div', { class: 'ak-field' }, h('label', { class: 'ak-label', for: 'match-' + item.id }, matchLabel), matchSelect(item, redraw)));
    }
    if (action === 'create' || (action === 'schedule' && !item.match)) {
      var list = h('select', { class: 'ak-input', id: 'list-' + item.id, 'data-field': 'list', onchange: function () { item.list = list.value; } },
        state.draft.lists.map(function (name) { return h('option', { value: name }, name); }));
      list.value = item.list;
      fields.push(h('div', { class: 'ak-field' }, h('label', { class: 'ak-label', for: 'list-' + item.id }, 'List'), list));
    }
    if (action === 'schedule') {
      var due = h('input', { class: 'ak-input', id: 'due-' + item.id, type: 'date', value: item.due, 'data-field': 'due', oninput: function () {
        item.due = due.value;
        refresh();
      } });
      fields.push(h('div', { class: 'ak-field' }, h('label', { class: 'ak-label', for: 'due-' + item.id }, 'Due date'), due));
    }

    var low = item.confidence < 0.6;
    var seen = 'Seen as ' + (item.detected === 'none' ? 'no symbol' : item.detected) + ', ' + Math.round(item.confidence * 100) + '%' + (low ? ' (low)' : '');
    var head = h('div', { class: 'bj-item-head' },
      h('label', { class: 'bj-check', for: 'include-' + item.id }, include, h('span', null, item.isDate ? 'Page date' : ignored ? 'Skipped' : 'Include')),
      h('span', { class: 'bj-badge', 'data-action-label': action }, ACTION_LABELS[action]));

    node.setAttribute('data-include', item.include && !ignored ? 'true' : 'false');
    node.setAttribute('data-action', action);
    node.appendChild(head);
    node.appendChild(h('p', { class: 'bj-ocr', 'data-testid': 'ocr-text' }, item.ocrText || '(empty line)'));
    node.appendChild(h('p', { class: 'bj-meta bj-seen' + (low ? ' bj-low' : '') }, seen));
    if (item.note) node.appendChild(h('p', { class: 'bj-meta', 'data-testid': 'note' }, item.note));
    if (item.ambiguous) node.appendChild(h('p', { class: 'bj-meta' }, 'More than one task fits. Pick the right one.'));
    node.appendChild(h('div', { class: 'ak-field' }, h('label', { class: 'ak-label', for: 'symbol-' + item.id }, 'Symbol'), symbol));
    fields.forEach(function (f) { node.appendChild(f); });
    return node;
  }

  function reviewView() {
    var accept$ = h('button', { type: 'button', class: 'ak-btn ak-btn-accent', 'data-action': 'accept', onclick: accept }, 'Accept');
    var hint = h('p', { class: 'bj-note bj-hint', 'data-testid': 'accept-hint', role: 'status' });
    function refresh() {
      var chosen = state.items.filter(function (item) { return item.include && actionOf(item) !== 'ignore'; });
      var first = null;
      chosen.some(function (item) {
        var p = problem(item);
        if (p) first = 'Line ' + item.id.slice(1) + ': ' + p + '.';
        return !!p;
      });
      accept$.disabled = !chosen.length || !!first;
      accept$.textContent = chosen.length ? 'Accept ' + chosen.length + (chosen.length === 1 ? ' item' : ' items') : 'Accept';
      hint.textContent = first || (chosen.length ? '' : 'Nothing is included yet.');
      if (!chosen.length || first) accept$.setAttribute('aria-describedby', 'accept-hint-text');
    }
    hint.id = 'accept-hint-text';

    var list = h('ul', { class: 'bj-list bj-items' }, state.items.map(function (item) { return card(item, refresh); }));
    var d = state.draft;
    var view = h('div', null,
      header('Review'),
      h('p', { class: 'bj-sub', 'data-testid': 'page-date' },
        'Page date: ' + formatDay(d.pageDate) + (d.pageDateSource === 'line' ? ' (read from the page)' : ' (the day you scanned)')),
      h('p', { class: 'bj-note' }, 'Check each line. Only included lines are written. The page date is not written to any task.'),
      errorBanner(),
      state.preview ? h('details', { class: 'bj-preview-fold' }, h('summary', null, 'Show the photo'), h('img', { src: state.preview, alt: 'The page you scanned' })) : null,
      list,
      h('div', { class: 'bj-bar' }, hint,
        h('div', { class: 'bj-actions' }, accept$,
          h('button', { type: 'button', class: 'ak-btn ak-btn-secondary', 'data-action': 'discard', onclick: reset }, 'Discard'))));
    refresh();
    return view;
  }

  var STATUS_TEXT = { written: 'Saved', kept: 'Kept, nothing to write', failed: 'Failed', skipped: 'Not tried' };

  function doneView() {
    var results = state.results || [];
    var failed = results.filter(function (r) { return !r.ok; }).length;
    var rows = results.map(function (r) {
      var item = state.items.filter(function (i) { return i.id === r.id; })[0];
      var label = r.task && r.task.summary ? r.task.summary : item ? (item.text || item.ocrText) : r.id;
      return h('li', { class: 'ak-row', 'data-result': r.id, 'data-status': r.status },
        h('div', { class: 'ak-row-grow' },
          h('p', { class: 'ak-row-title' }, label),
          h('p', { class: 'ak-row-sub' }, STATUS_TEXT[r.status] + (r.error ? ': ' + r.error : ''))));
    });
    return h('div', null,
      header('Done'),
      h('p', { class: 'bj-sub', 'data-testid': 'result-summary' },
        failed ? failed + (failed === 1 ? ' item was not saved.' : ' items were not saved.') : 'Everything was saved.'),
      failed ? h('p', { class: 'bj-note' }, 'Nothing is retried. Scan the page again for the lines that did not go through.') : null,
      h('ul', { class: 'bj-list ak-list' }, rows),
      h('div', { class: 'bj-actions bj-pad' },
        h('a', { class: 'ak-btn ak-btn-accent', href: '/backlog', 'data-action': 'to-backlog' }, 'Back to the backlog'),
        h('button', { type: 'button', class: 'ak-btn ak-btn-secondary', 'data-action': 'again', onclick: reset }, 'Scan another page')));
  }

  function render() {
    var view;
    if (state.stage === 'busy') view = busyView('Reading the page. This can take a few seconds.');
    else if (state.stage === 'applying') view = busyView('Saving.');
    else if (state.stage === 'review') view = reviewView();
    else if (state.stage === 'done') view = doneView();
    else view = pickView();
    app.setAttribute('data-stage', state.stage);
    app.replaceChildren(view);
  }

  /* ---------- start ---------- */

  AppKit.themeColor.start();
  AppKit.sw.register({ url: '/sw.js', scope: '/' });
  render();
})();
