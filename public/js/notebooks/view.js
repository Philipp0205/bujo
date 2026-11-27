/*
 * Notebooks render functions: the header, the list of notebooks, the detail of one notebook (its dates, its sections of logs, the grid
 * of page numbers) and the start button. They build nodes and call back, they never fetch. Needs ak-dom.js, notebooks/copy.js,
 * notebooks/model.js, index/model.js (the label of a page), index/copy.js and index/photo.js (a page's kept photo).
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var N = window.BujoNotebooks = window.BujoNotebooks || {};

  /** The header of the notebook list: the italic title only. The tab bar does the navigation. */
  function listHeader() {
    return h('div', { class: 'paper-head' }, h('h1', { 'data-testid': 'notebooks-title' }, N.copy.title));
  }

  /** The header of one notebook: its name, and the way back to the list. */
  function detailHeader(notebook, onBack) {
    return h('div', { class: 'paper-head' },
      h('h1', { 'data-testid': 'notebook-title' }, notebook.name),
      h('button', { class: 'paper-link collection-back', type: 'button', 'data-action': 'notebook-back', 'aria-label': N.copy.backLabel, onclick: onBack }, N.copy.back));
  }

  /** The "Start new notebook" button, in the row of quiet actions. */
  function startAction(onStart) {
    return h('div', { class: 'notes-actions' },
      h('button', { class: 'paper-link', type: 'button', 'data-action': 'start-notebook', 'data-testid': 'start-notebook', onclick: onStart }, N.copy.start));
  }

  /** One notebook as a row: its name with the active mark, its dates and page count. A tap opens it. */
  function notebookRow(notebook, onOpen) {
    var copy = N.copy;
    return h('li', { class: 'collection-item' },
      h('button', {
        class: 'collection-row notebook-row', type: 'button', 'data-testid': 'notebook-row', 'data-id': notebook.id, 'data-active': notebook.active ? '1' : '0',
        'aria-label': copy.openLabel(notebook.name), onclick: function () { onOpen(notebook); }
      }, h('span', { class: 'notebook-main' },
        h('span', { class: 'collection-row-name', 'data-testid': 'notebook-name' }, notebook.name),
        h('span', { class: 'notebook-sub', 'data-testid': 'notebook-dates' }, N.model.datesOf(notebook) + ' \u00b7 ' + copy.pageCount(notebook.pageCount)),
        typeof notebook.scannedCount === 'number'
          ? h('span', { class: 'notebook-sub', 'data-testid': 'notebook-scanned' }, copy.scannedCount(notebook.scannedCount, notebook.pageCount)) : null),
        notebook.active ? h('span', { class: 'notebook-active', 'data-testid': 'notebook-active' }, copy.activeMark) : null));
  }

  /** The list of notebooks, the active one first (the order the server gave). */
  function notebookList(notebooks, onOpen) {
    return h('ul', { class: 'collection-list', 'data-testid': 'notebook-list' }, notebooks.map(function (notebook) { return notebookRow(notebook, onOpen); }));
  }

  /** A small italic heading over a section. */
  function heading(text) {
    return h('h2', { class: 'notes-heading' }, text);
  }

  /** One scanned log page as a row: its label ("Wed 18.11"), its page number on the right, then its photo thumbnail. A tap opens it in the log.
   * When another row of the section has a thumbnail, a row without one keeps the space, so the page numbers line up. */
  function pageRow(item, onOpen, reserve) {
    var label = window.BujoIndex.model.labelOf(item);
    var mark = window.BujoIndex.copy.pageMark(item.number);
    var thumb = window.BujoIndex.photo.thumb(item) || (reserve ? h('span', { class: 'page-thumb-gap', 'aria-hidden': 'true' }) : null);
    return h('li', { class: 'collection-item' + (thumb ? ' collection-item-photo' : '') },
      h('button', {
        class: 'collection-row', type: 'button', 'data-testid': 'log-row', 'data-kind': item.kind, 'data-ref': item.ref,
        'aria-label': window.BujoIndex.copy.openLabel(mark, label), onclick: function () { onOpen(item); }
      }, h('span', { class: 'collection-row-name' }, label), h('span', { class: 'collection-row-meta' }, h('span', { class: 'collection-row-page' }, mark))), thumb);
  }

  /** A section of scanned log pages under its heading, or a quiet line when none is scanned. */
  function logSection(title, key, pages, onOpen) {
    var reserve = pages.some(window.BujoIndex.photo.has);
    return h('section', { class: 'notes-section', 'data-testid': 'section-' + key },
      heading(title),
      pages.length ? h('ul', { class: 'collection-list' }, pages.map(function (item) { return pageRow(item, onOpen, reserve); })) : h('p', { class: 'notebook-none' }, N.copy.sectionEmpty));
  }

  /** The Daily, Monthly and Future sections of a notebook. */
  function logSections(pages, onOpen) {
    var copy = N.copy.sections;
    var parts = N.model.sections(pages);
    return [logSection(copy.daily, 'daily', parts.daily, onOpen), logSection(copy.month, 'month', parts.month, onOpen), logSection(copy.future, 'future', parts.future, onOpen)];
  }

  /** The dates, page count and how many pages are scanned, as a muted line under the title. */
  function summary(notebook, status) {
    var text = N.model.datesOf(notebook) + ' \u00b7 ' + N.copy.scannedCount(N.model.scannedCount(status), notebook.pageCount);
    return h('p', { class: 'notebook-summary', 'data-testid': 'notebook-summary' }, text);
  }

  /** One number of the grid: a scanned page is a button that opens it, an unscanned one is a quiet outlined number. */
  function cell(entry, onOpen) {
    var copy = N.copy;
    if (!entry.scanned) {
      return h('li', { class: 'notebook-cell-item' },
        h('span', { class: 'notebook-cell', 'data-testid': 'index-cell', 'data-scanned': '0', 'data-number': String(entry.number) }, String(entry.number)));
    }
    var label = window.BujoIndex.model.labelOf(entry.item);
    var photo = window.BujoIndex.photo.has(entry.item);
    var button = h('button', {
      class: 'notebook-cell notebook-cell-scanned', type: 'button', 'data-testid': 'index-cell', 'data-scanned': '1', 'data-number': String(entry.number), 'data-photo': photo ? '1' : '0',
      'aria-label': photo ? copy.openPagePhoto(entry.number, label) : copy.openPage(entry.number, label)
    }, String(entry.number));
    // A page with a kept photo opens the photo here. Its row in the lists above still opens the page itself.
    button.addEventListener('click', function () { if (photo) window.BujoIndex.photo.open(entry.item, button); else onOpen(entry.item); });
    return h('li', { class: 'notebook-cell-item' }, button);
  }

  /** The index: every page number of the notebook, scanned ones filled and tappable. */
  function indexGrid(status, onOpen) {
    return h('section', { class: 'notes-section', 'data-testid': 'notebook-index' },
      heading(N.copy.sections.index),
      h('p', { class: 'notebook-legend' }, N.copy.indexLegend),
      h('ul', { class: 'notebook-grid', 'data-testid': 'index-grid' }, status.map(function (entry) { return cell(entry, onOpen); })));
  }

  N.view = { listHeader: listHeader, detailHeader: detailHeader, startAction: startAction, notebookList: notebookList, logSections: logSections, summary: summary, indexGrid: indexGrid, heading: heading };
})();
