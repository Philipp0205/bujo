/*
 * The scan review sheet (mock 05): the day, then one editable row per scanned line, then the apply button.
 * Rows are updated in place, never rebuilt, so a field keeps focus while the person types.
 * Needs ak-dom.js, ak-sheet.js, nav/overlays.js, copy.js, scan/copy.js, scan/model.js, dates.js and glyph.js.
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};
  L.scan = L.scan || {};

  var ICON = { viewBox: '0 0 16 16', width: 16, height: 16 };

  /** The words under a row title: confidence, a spelling hint when it is low, and a note when the app also changed the entry. */
  function metaText(item) {
    var copy = L.copy.scan.review;
    var parts = [L.scan.model.percent(item) + '%'];
    if (item.time) parts.push(item.time);
    if (item.important) parts.push(copy.important);
    if (L.scan.model.isLowConfidence(item)) parts.push(copy.checkSpelling);
    if (item.status === 'edited' && item.contested) parts.push(copy.changedInApp);
    return parts.join(' \u00b7 ');
  }

  /** The faint words of the match line: what the line matches and what applying does to it, or that it was un-matched. */
  function matchText(item) {
    var copy = L.copy.scan.review;
    var match = L.scan.model.matchOf(item);
    if (item.unmatched) return item.wasMatch ? copy.notMatched(item.wasMatch.title) : '';
    if (!match) return '';
    if (match.kind === 'trace') return copy.matchesTrace + ' \u00b7 ' + copy.traceChange;
    var change = copy.matches(match.title) + ' \u00b7 ' + copy.matchChange[L.scan.model.changeKey(item)];
    return item.moveTo ? change + ' \u00b7 ' + copy.movesTo(item.moveTo) : change;
  }

  /** The un-match control: turns a matched line into a new entry, or a line that was un-matched back into a match. */
  function matchToggle(item, onToggle) {
    var copy = L.copy.scan.review;
    var button = h('button', { class: 'scan-unmatch', type: 'button', 'data-field': 'unmatch', onclick: function () {
      if (item.unmatched) L.scan.model.rematch(item);
      else L.scan.model.unmatch(item);
      onToggle();
    } });
    return {
      node: button,
      show: function (visible) {
        button.hidden = !visible;
        button.textContent = item.unmatched ? copy.rematch : copy.unmatch;
        var was = item.wasMatch;
        button.setAttribute('aria-label', item.unmatched ? copy.rematchLabel : copy.unmatchLabel(was ? was.title : (item.target && item.target.title)));
      }
    };
  }

  /** The "was" line of an edited row: the old glyph and title, then the old tag or time when those changed. */
  function wasLine(item) {
    var copy = L.copy.scan.review;
    var was = L.scan.model.changedFields(item);
    if (!was) return null;
    var parts = [h('span', { class: 'scan-was-label' }, copy.was), h('span', { class: 'scan-was-glyph' }, L.glyph.typeGlyph(was.type)), h('span', { class: 'scan-was-title' }, was.title)];
    if (was.tags) parts.push(h('span', { class: 'scan-was-extra' }, was.tags.value.length ? was.tags.value.map(function (tag) { return '#' + tag; }).join(' ') : copy.noTag));
    if (was.time) parts.push(h('span', { class: 'scan-was-extra' }, was.time.value || copy.noTime));
    return parts;
  }

  /** The type picker: a native select laid transparently over the glyph, so the phone's own picker opens. Events are only offered where the page files on days. */
  function typePicker(item, events, onChange) {
    var glyph = h('span', { class: 'scan-glyph' }, L.glyph.typeGlyph(item.type));
    var star = h('span', { class: 'scan-star', 'aria-hidden': 'true', 'data-testid': 'scan-star' }, '*');
    var types = L.glyph.SCAN_TYPES.filter(function (type) { return events || type !== 'event' || item.type === 'event'; });
    var select = h('select', { class: 'scan-type', 'aria-label': L.copy.scan.review.type, 'data-field': 'type' },
      types.map(function (type) {
        return h('option', { value: type, selected: type === item.type }, L.copy.typeLabels[type]);
      }));
    select.value = item.type;
    select.addEventListener('change', function () {
      item.type = select.value;
      onChange();
    });
    return {
      node: h('label', { class: 'scan-sym' }, star, glyph, select),
      show: function () { star.hidden = !item.important; glyph.replaceChildren(L.glyph.typeGlyph(item.type)); select.value = item.type; }
    };
  }

  /** A text input that writes into the item as the person types and asks for a check when they leave it. */
  function textInput(item, field, attrs, onChange) {
    var input = h('input', Object.assign({ type: 'text', autocomplete: 'off', value: item[field] }, attrs, { class: 'scan-input-' + (attrs['data-field'] || field) }));
    if (!attrs['data-field']) input.setAttribute('data-field', field);
    input.addEventListener('input', function () { item[field] = input.value; onChange(false); });
    input.addEventListener('change', function () { onChange(true); });
    return input;
  }

  /** The nest switch of a row (daily pages): a quiet underlined word that nests the line under the one above, or takes it out again. Hidden on the first line. */
  function nestToggle(state, item, onToggle) {
    var copy = L.copy.scan.review;
    var button = h('button', { class: 'scan-nest', type: 'button', 'data-field': 'nest', 'data-testid': 'scan-nest', onclick: function () {
      L.scan.model.toggleNest(state, item);
      onToggle();
    } });
    return {
      node: button,
      show: function () {
        var nested = L.scan.model.indentOf(state, item) === 1;
        button.hidden = !L.scan.model.canNest(state, item);
        button.textContent = nested ? copy.unnest : copy.nest;
        button.setAttribute('aria-pressed', nested ? 'true' : 'false');
        button.setAttribute('aria-label', nested ? copy.unnestLabel : copy.nestLabel);
      }
    };
  }

  /** The keep check at the end of a row: a box (ticked while the line is kept) with the word "Keep" under it, so it reads as a control. */
  function keepToggle(item, onToggle) {
    var copy = L.copy.scan.review;
    var button = h('button', { class: 'scan-keep', type: 'button', role: 'checkbox', 'data-field': 'include', 'aria-label': copy.keep, onclick: function () {
      item.include = !item.include;
      item.touched = true;
      onToggle();
    } }, h('span', { class: 'scan-keep-box', 'aria-hidden': 'true' }, L.glyph.use('g-check', { viewBox: '0 0 24 24', width: 16, height: 16 })),
    h('span', { class: 'scan-keep-label', 'aria-hidden': 'true', 'data-testid': 'scan-keep-label' }, copy.keepLabel));
    return {
      node: button,
      show: function () {
        button.setAttribute('aria-checked', item.include ? 'true' : 'false');
      }
    };
  }

  /** One line of the page as an editable row. Returns its node and a refresh that redraws the changing parts. hooks.showUnchanged() says whether unchanged rows are open. */
  function row(state, item, hooks) {
    var meta = h('span', { class: 'scan-meta' });
    var past = h('span', { class: 'scan-past', 'data-testid': 'scan-past', role: 'note', 'aria-label': L.copy.scan.review.pastLabel }, L.copy.scan.review.past);
    var was = h('div', { class: 'scan-was', 'data-role': 'was' });
    var matched = h('div', { class: 'scan-match', 'data-role': 'match' });
    var unmatch = matchToggle(item, function () { hooks.changed(true); });
    var picker = typePicker(item, L.scan.model.allowsEvent(state.kind), function () { hooks.changed(true); });
    var keep = keepToggle(item, function () { hooks.changed(false); });
    var place = L.scan.kind.placeField(state, item, hooks.moved, hooks.typed);
    var nest = nestToggle(state, item, function () { hooks.changed(false); });
    var title = textInput(item, 'title', { maxlength: 200, 'aria-label': L.copy.scan.review.titleLabel }, hooks.changed);
    var tag = textInput(item, 'tagText', { maxlength: 120, placeholder: L.copy.scan.review.tag, 'aria-label': L.copy.scan.review.tagLabel, 'data-field': 'tag' }, function (leave) { hooks.changed(false, leave); });
    var node = h('div', { class: 'scan-row', 'data-id': item.id },
      picker.node,
      h('div', { class: 'scan-main' }, title, was, h('div', { class: 'scan-under' }, meta, past, tag), matched, unmatch.node, nest.node, place.node),
      keep.node);

    function refresh() {
      var parts = wasLine(item);
      var text = matchText(item);
      node.setAttribute('data-include', item.include ? 'true' : 'false');
      node.setAttribute('data-indent', String(L.scan.model.indentOf(state, item)));
      node.setAttribute('data-status', item.status);
      node.setAttribute('data-match', item.unmatched ? 'unmatched' : (L.scan.model.matchOf(item) ? 'matched' : 'none'));
      node.setAttribute('data-low', L.scan.model.isLowConfidence(item) ? 'true' : 'false');
      was.hidden = !parts;
      was.replaceChildren.apply(was, parts || []);
      matched.hidden = text === '';
      matched.textContent = text;
      unmatch.show(text !== '');
      meta.textContent = metaText(item);
      past.hidden = !L.scan.model.isPast(item);
      picker.show();
      nest.show();
      place.show();
      keep.show();
    }
    refresh();
    return { node: node, refresh: refresh };
  }

  /** The day row: a mini page icon, the day, where it came from, and an invisible date input over all of it. */
  function dateRow(state, onPick) {
    var copy = L.copy.scan.review;
    var day = h('span', { class: 'scan-day', 'data-testid': 'scan-date' });
    var source = h('span', { class: 'scan-source', 'data-testid': 'scan-date-source' });
    var input = h('input', { class: 'scan-date-input', type: 'date', 'aria-label': copy.date, 'data-field': 'date', value: state.date });
    input.addEventListener('change', function () {
      if (!input.value) return;
      L.scan.model.setDate(state, input.value);
      onPick();
    });
    var node = h('label', { class: 'scan-date' }, L.glyph.use('g-scan-page', { viewBox: '0 0 40 52', width: 40, height: 52 }),
      h('span', { class: 'scan-date-text' }, day, source), input);
    var today = h('button', { class: 'scan-continue-today', type: 'button', 'data-testid': 'scan-continue-today', onclick: function () {
      L.scan.model.setDate(state, state.fallbackDate);
      onPick();
    } }, copy.useToday);
    return {
      node: h('div', { class: 'scan-date-block' }, node, today),
      refresh: function () {
        var texts = { page: copy.dateFromPage, fallback: state.fallbackDate === L.dates.todayIso() ? copy.dateFallback : copy.dateOpenDay, picked: copy.datePicked };
        day.textContent = L.dates.dayHeading(state.date);
        source.textContent = state.dateSource === 'continues' ? copy.dateContinues(L.dates.dayHeading(state.continues)) : texts[state.dateSource];
        today.hidden = state.dateSource !== 'continues';
        input.value = state.date;
      }
    };
  }

  /** The rows of the page and their group headings. relayout() puts them in page order again, rebuild() makes them anew for a kind. */
  function rowsView(state, hooks) {
    var node = h('div', { class: 'scan-rows', 'data-testid': 'scan-rows' });
    var rows = [];

    function build() {
      rows = state.items.map(function (item) { return { item: item, view: row(state, item, hooks) }; });
      relayout();
    }

    /** Puts the rows in order, with a heading above each group (a month or a day), and moves nothing else. */
    function relayout() {
      var nodes = [];
      var last = null;
      L.scan.model.ordered(state).forEach(function (entry) {
        if (entry.group !== last && (state.kind === 'future' || state.kind === 'calendar')) nodes.push(L.scan.kind.groupHeading(state, entry.group));
        last = entry.group;
        nodes.push(rows.filter(function (candidate) { return candidate.item === entry.item; })[0].view.node);
      });
      node.replaceChildren.apply(node, nodes);
    }

    function refresh() { rows.forEach(function (entry) { entry.view.refresh(); }); }
    build();
    return { node: node, refresh: refresh, relayout: relayout, rebuild: build };
  }

  /** The words under the sheet title: the page (a day, a month, or the future log) and what will be written. */
  function subtitleText(state, counts) {
    var copy = L.copy.scan.review;
    var page = { daily: function () { return L.dates.dayHeading(state.date); }, future: function () { return copy.futureSubject; } }[state.kind];
    return (page ? page() : copy.monthLabel(state.month)) + ' \u00b7 ' + copy.writes(counts);
  }

  /** The trouble line for a problem key ('' says nothing). A day problem names the line, and says so when the typed day is not in the month. */
  function problemText(state, problem) {
    var errors = L.copy.scan.errors;
    if (problem === 'day') return dayText(errors, L.scan.model.dayProblemOf(state));
    return { paper: errors.paperInvalid, title: errors.titleRequired, month: errors.monthRequired }[problem] || '';
  }

  /** The alert for a kept line with no usable day: it names the line (a blank title reads as "this line"). */
  function dayText(errors, found) {
    var title = found && found.title ? found.title : L.copy.scan.review.thisLine;
    return found && found.day ? errors.dayMissing(title, found.day) : errors.dayRequired(title);
  }

  /** Opens the sheet. handlers.check(state), handlers.apply(state) and handlers.setKind(state, kind) return promises, handlers.done(result) runs after a save.
   * handlers.typeRow is the log or note switch node shown on top. */
  function open(state, handlers) {
    var copy = L.copy.scan.review;
    var subtitle = h('p', { class: 'sheet-sub', 'data-testid': 'scan-sub' });
    var slot = h('div', { class: 'sheet-slot', 'aria-live': 'polite' });
    var apply = h('button', { class: 'ak-btn ak-btn-accent', type: 'button', 'data-action': 'apply' });
    var date = dateRow(state, function () { recheck(); });
    var month = L.scan.kind.monthRow(state, function () { recheck(); });
    var pages = L.scan.page.row(state, function () { recheck(); });
    var number = L.scan.number.row(state, function () { refreshAll(); });
    var kinds = L.scan.kind.kindSwitch(state, switchTo);
    var rows = rowsView(state, {
      changed: function (check, leave) { if (check || leave) recheck(); else refreshAll(); },
      typed: function () { refreshAll(); },
      moved: function () { rows.relayout(); recheck(); }
    });
    var busy = false;
    var sheet = null;

    function say(message) { Bujo.say(slot, message); }

    /** Redraws the counts, the rows, the period and the apply button from the state. */
    function refreshAll() {
      var counts = L.scan.model.counts(state);
      var problem = L.scan.model.problem(state);
      subtitle.textContent = subtitleText(state, counts);
      apply.textContent = busy ? copy.applying : copy.apply(counts);
      apply.disabled = busy || problem !== '';
      say(problemText(state, problem));
      kinds.show(busy);
      date.node.hidden = state.kind !== 'daily';
      month.node.hidden = state.kind !== 'calendar' && state.kind !== 'month-task';
      date.refresh();
      month.refresh();
      pages.refresh();
      number.refresh();
      rows.refresh();
    }

    /** Asks the server about the page and the edited lines, then redraws. A failed check keeps what is on screen. */
    function recheck() {
      refreshAll();
      handlers.check(state).then(function (answer) {
        L.scan.model.mergeChecks(state, answer);
        refreshAll();
      }, function () { /* the apply step checks again, so a missed hint is harmless */ });
    }

    /** Reads the page again as another kind. The rows are made anew, so edits to the old reading are gone. */
    function switchTo(kind) {
      if (busy) return;
      busy = true;
      refreshAll();
      handlers.setKind(state, kind).then(function (draft) {
        L.scan.model.replaceDraft(state, draft);
        busy = false;
        rows.rebuild();
        recheck();
      }, function (error) {
        busy = false;
        refreshAll();
        say(error && error.message ? error.message : L.copy.scan.errors.kindFailed);
      });
    }

    function submit() {
      if (busy || L.scan.model.problem(state)) return;
      busy = true;
      refreshAll();
      handlers.apply(state).then(function (result) {
        sheet.close();
        handlers.done(result);
      }, function (error) {
        busy = false;
        refreshAll();
        say(error && error.message ? error.message : L.copy.scan.errors.applyFailed);
      });
    }

    apply.addEventListener('click', submit);
    var node = h('div', { class: 'ak-sheet sheet-entry sheet-scan', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'scan-review-title', 'data-testid': 'scan-review' },
      h('div', { class: 'ak-sheet-head' }, h('div', { class: 'ak-grabber' }), h('h2', { class: 'sheet-title', id: 'scan-review-title' }, copy.title), subtitle),
      h('div', { class: 'ak-sheet-scroll' }, slot, handlers.typeRow, kinds.node, date.node, pages.node, month.node, number.node, rows.node),
      h('div', { class: 'ak-sheet-dock' }, apply));
    refreshAll();
    sheet = BujoNav.overlays.showSheet(node, {});
    L.gap.banner.known().then(function (known) { state.knownPages = known; number.refresh(); });
    return sheet;
  }

  L.scan.review = { open: open };
})();
