/*
 * The page type picker on top of the scan review and the note sheet: a breadcrumb of hand-drawn words (each in a pen loop, linked by pen
 * arrows). Tapping a word opens a small hand-drawn popover with that step's choices. It closes on a pick, an outside tap, Escape or when
 * focus leaves it. A view only: the steps live in scan/picker/model.js, what a pick does is hooks.pick(step, value) (scan/session.js).
 * Needs ak-dom.js, scan/copy.js, scan/model.js, scan/marker.js and scan/picker/model.js. Its look is in log-scan.css.
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};
  L.scan = L.scan || {};
  L.scan.picker = L.scan.picker || {};

  /** Where the page's type came from: the guess while it is still the guessed one, else the person. */
  function sourceOf(page) {
    return page.guess && page.type === page.guess.type ? page.guess.source : 'picked';
  }

  /** The words under a daily page's picker: a rescan of an existing page of the day, the first page, or a new page that follows. */
  function pageNote(page) {
    var copy = L.copy.scan.review;
    var state = page.state;
    if (L.scan.picker.model.typeOf(page) !== 'log' || state.kind !== 'daily') return '';
    if (state.pages.indexOf(state.page) >= 0) return copy.pageRescan(state.page);
    return state.page === 1 ? copy.pageFirst : copy.pageNew(state.page);
  }

  /** One word of the breadcrumb in its pen loop. */
  function word(entry, onOpen) {
    var label = L.copy.scan.picker.steps[entry.step] + ': ' + entry.label;
    return h('button', {
      class: 'scan-pick', type: 'button', 'data-step': entry.step, 'data-value': String(entry.value), 'aria-haspopup': 'listbox', 'aria-expanded': 'false',
      'aria-label': label, onclick: function () { onOpen(entry.step); }
    }, L.scan.marker.pill('pick:' + entry.step + ':' + entry.value), h('span', { class: 'scan-pick-text' }, entry.label));
  }

  /** One choice of a popover, in its own loop. */
  function choice(option, step, onPick) {
    return h('button', {
      class: 'scan-choice', type: 'button', role: 'option', 'data-value': String(option.value), 'aria-selected': option.selected ? 'true' : 'false',
      onclick: function () { onPick(option.value); }
    }, L.scan.marker.pill('choice:' + step + ':' + option.value), h('span', { class: 'scan-pick-text' }, option.label));
  }

  /** Moves focus along the choices of a popover with the arrow keys, Home and End. */
  function moveFocus(event, choices) {
    var keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    var target;
    if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = choices.length - 1;
    else if (keys[event.key]) target = choices.indexOf(document.activeElement) + keys[event.key];
    else return;
    event.preventDefault();
    choices[Math.max(0, Math.min(choices.length - 1, target))].focus();
  }

  /**
   * The picker for a page ({ type, noteKind, state, guess }). hooks.pick(step, value) runs when a choice is picked.
   * Returns { node, show }: show() draws the words again from the page, after a pick or a change of the review.
   */
  function create(page, hooks) {
    var row = h('div', { class: 'scan-picker-row', role: 'group', 'aria-label': L.copy.scan.picker.group });
    var note = h('p', { class: 'scan-picker-note', 'data-testid': 'scan-page-note' });
    var node = h('div', { class: 'scan-picker', 'data-testid': 'scan-picker' }, row, note);
    var pop = null;
    var onOutside = null;
    var drawn = '';

    function trigger(step) { return row.querySelector('[data-step="' + step + '"]'); }

    /** Closes the popover. With refocus the trigger of its step gets the focus back. */
    function close(refocus) {
      if (!pop) return;
      var step = pop.getAttribute('data-step');
      pop.remove();
      pop = null;
      document.removeEventListener('pointerdown', onOutside, true);
      if (trigger(step)) {
        trigger(step).setAttribute('aria-expanded', 'false');
        if (refocus) trigger(step).focus();
      }
    }

    function pick(step, value) {
      close(false);
      hooks.pick(step, value);
      show();
      if (trigger(step)) trigger(step).focus();
    }

    /** Opens the popover of a step under the words, with the picked choice focused. */
    function open(step) {
      var again = pop && pop.getAttribute('data-step') === step;
      close(false);
      if (again) return;
      var choices = L.scan.picker.model.options(step, page).map(function (option) { return choice(option, step, function (value) { pick(step, value); }); });
      pop = h('div', { class: 'scan-pop', role: 'listbox', 'data-step': step, 'aria-label': L.copy.scan.picker.options[step] }, choices);
      pop.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') {
          event.stopPropagation();
          close(true);
        } else moveFocus(event, choices);
      });
      pop.addEventListener('focusout', function (event) {
        if (event.relatedTarget && !pop.contains(event.relatedTarget) && !node.contains(event.relatedTarget)) close(false);
      });
      onOutside = function (event) { if (!node.contains(event.target)) close(false); };
      document.addEventListener('pointerdown', onOutside, true);
      node.appendChild(pop);
      trigger(step).setAttribute('aria-expanded', 'true');
      (choices.filter(function (entry) { return entry.getAttribute('aria-selected') === 'true'; })[0] || choices[0]).focus();
    }

    /** Draws the words: each step in its loop, joined by pen arrows (a short branch line after Collection). An arrow stays with the word after it when the row wraps.
     * Words that did not change are left alone, so a tap that began on one is not lost when a blur redraws the review. */
    function show() {
      var steps = L.scan.picker.model.steps(page);
      var link = L.scan.picker.model.linkOf(page);
      var signature = link + '|' + steps.map(function (entry) { return entry.step + ':' + entry.value + ':' + entry.label; }).join('|');
      if (signature !== drawn) {
        var nodes = [];
        steps.forEach(function (entry, at) {
          if (at === 0) nodes.push(word(entry, open));
          else nodes.push(h('span', { class: 'scan-unit' }, L.scan.marker.link(at === 1 ? link : 'arrow', 'link:' + at + ':' + steps[at - 1].value), word(entry, open)));
        });
        row.replaceChildren.apply(row, nodes);
        drawn = signature;
      }
      node.setAttribute('data-source', sourceOf(page));
      note.textContent = pageNote(page);
      note.hidden = note.textContent === '';
    }

    show();
    return { node: node, show: show, close: close };
  }

  L.scan.picker.view = { create: create };
})();
