/*
 * bujo backlog screen (read-only). Plain JS, no build step.
 * Components and helpers come from app-kit: AppKit.h (ak-dom.js), AppKit.largeTitle, AppKit.pullToRefresh
 * (ak-native.js), AppKit.themeColor and AppKit.installPrompt, AppKit.sw.
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var app = document.getElementById('app');

  var FILTERS = [
    { id: 'open', label: 'All open' },
    { id: 'tag', label: 'By tag' },
    { id: 'priority', label: 'By priority' },
    { id: 'someday', label: 'Someday' },
    { id: 'scheduled', label: 'Scheduled' }
  ];
  var PRIORITY_NAMES = { 1: 'High', 5: 'Medium', 9: 'Low' };
  var PRIORITY_MARKS = { 1: '!!!', 5: '!!', 9: '!' };

  var state = { filter: 'open', data: null, error: null, loading: true };
  var titleHandle = null;

  /* ---------- data ---------- */

  function load() {
    state.loading = true;
    return fetch('/api/backlog', { headers: { accept: 'application/json' } })
      .then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (body) {
          if (!response.ok) throw new Error(body.error || 'Could not load the backlog.');
          return body;
        });
      })
      .then(function (body) {
        state.data = body;
        state.error = null;
      })
      .catch(function (error) {
        state.error = error && error.message ? error.message : 'Could not load the backlog.';
      })
      .then(function () {
        state.loading = false;
        render();
      });
  }

  /* ---------- helpers ---------- */

  function todayIso() {
    var now = new Date();
    var month = String(now.getMonth() + 1).padStart(2, '0');
    var day = String(now.getDate()).padStart(2, '0');
    return now.getFullYear() + '-' + month + '-' + day;
  }

  function formatDue(due) {
    var parts = due.date.split('-').map(Number);
    var date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    var text = date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
    return due.time ? text + ' ' + due.time.slice(0, 5) : text;
  }

  function byDue(a, b) {
    var da = a.due.date + (a.due.time || '');
    var db = b.due.date + (b.due.time || '');
    return da < db ? -1 : da > db ? 1 : 0;
  }

  /** Returns [{ title, tasks }]. A flat filter has one group with no title. */
  function groupsFor(filter, tasks) {
    var groups = [];
    if (filter === 'open') {
      return [{ title: null, tasks: tasks }];
    }
    if (filter === 'someday') {
      return [{ title: null, tasks: tasks.filter(function (t) { return t.someday; }) }];
    }
    if (filter === 'scheduled') {
      return [{ title: null, tasks: tasks.filter(function (t) { return t.due; }).sort(byDue) }];
    }
    if (filter === 'priority') {
      [1, 5, 9, null].forEach(function (priority) {
        var inGroup = tasks.filter(function (t) { return t.priority === priority; });
        if (inGroup.length) groups.push({ title: priority === null ? 'No priority' : PRIORITY_NAMES[priority], tasks: inGroup });
      });
      return groups;
    }
    // tag: a task shows under every tag it has. Someday is a tag like any other.
    var byTag = {};
    var names = [];
    var untagged = [];
    tasks.forEach(function (task) {
      if (!task.categories.length) untagged.push(task);
      task.categories.forEach(function (tag) {
        if (!byTag[tag]) { byTag[tag] = []; names.push(tag); }
        byTag[tag].push(task);
      });
    });
    names.sort(function (a, b) { return a.localeCompare(b, 'de'); });
    names.forEach(function (tag) { groups.push({ title: tag, tasks: byTag[tag] }); });
    if (untagged.length) groups.push({ title: 'No tag', tasks: untagged });
    return groups;
  }

  var EMPTY_TEXT = {
    open: 'Nothing open. The backlog is clear.',
    tag: 'No open tasks to group.',
    priority: 'No open tasks to group.',
    someday: 'Nothing tagged someday.',
    scheduled: 'Nothing has a due date.'
  };

  /* ---------- views ---------- */

  function taskRow(task) {
    var today = todayIso();
    var meta = [h('span', { class: 'bj-list-name' }, task.list)];
    if (task.due) {
      var overdue = task.due.date < today;
      meta.push(h('span', { class: 'bj-due' + (overdue ? ' bj-overdue' : ''), 'data-overdue': overdue ? 'true' : null },
        (overdue ? 'Overdue ' : 'Due ') + formatDue(task.due)));
    }
    if (task.status === 'IN-PROCESS') meta.push(h('span', null, 'In progress'));

    var body = [
      h('p', { class: 'ak-row-title' }, task.summary || '(no title)'),
      h('p', { class: 'bj-meta' }, meta)
    ];
    if (task.categories.length) {
      body.push(h('p', { class: 'bj-tags' }, task.categories.map(function (tag) {
        return h('span', { class: 'ak-chip', 'data-tag': tag }, tag);
      })));
    }

    return h('li', { class: 'ak-row', 'data-uid': task.uid },
      h('div', { class: 'ak-row-grow' }, body),
      task.priority
        ? h('span', { class: 'bj-prio', 'data-priority': task.priority, title: PRIORITY_NAMES[task.priority] + ' priority', 'aria-label': PRIORITY_NAMES[task.priority] + ' priority' }, PRIORITY_MARKS[task.priority])
        : null
    );
  }

  function filterBar() {
    return h('div', { class: 'bj-filters', role: 'group', 'aria-label': 'Filter' }, FILTERS.map(function (filter) {
      var on = state.filter === filter.id;
      return h('button', {
        type: 'button',
        class: 'ak-chip' + (on ? ' ak-chip-on' : ''),
        'aria-pressed': on ? 'true' : 'false',
        'data-filter': filter.id,
        onclick: function () { state.filter = filter.id; render(); }
      }, filter.label);
    }));
  }

  function skeleton() {
    return h('div', { class: 'bj-loading', 'aria-busy': 'true', 'aria-label': 'Loading' },
      [0, 1, 2].map(function () {
        return h('div', { 'aria-hidden': 'true' },
          h('div', { class: 'ak-skeleton ak-skeleton-line' }),
          h('div', { class: 'ak-skeleton ak-skeleton-line ak-skeleton-short' }));
      }));
  }

  function content() {
    if (state.loading && !state.data) return skeleton();
    if (state.error && !state.data) {
      return h('div', { class: 'bj-state', role: 'alert', 'data-state': 'error' },
        h('div', { class: 'ak-empty' }, state.error),
        h('button', { type: 'button', class: 'ak-btn ak-btn-secondary', onclick: function () { load(); } }, 'Try again'));
    }
    var groups = groupsFor(state.filter, state.data.tasks).filter(function (g) { return g.tasks.length; });
    if (!groups.length) {
      return h('div', { class: 'bj-state', 'data-state': 'empty' }, h('div', { class: 'ak-empty' }, EMPTY_TEXT[state.filter]));
    }
    return h('div', null, groups.map(function (group) {
      return h('section', { 'data-group': group.title || 'all' },
        group.title ? h('h2', { class: 'bj-group-title' }, group.title) : null,
        h('ul', { class: 'bj-list ak-list' }, group.tasks.map(taskRow)));
    }));
  }

  function subtitle() {
    if (!state.data) return null;
    var count = state.data.tasks.length;
    var text = count + (count === 1 ? ' open task' : ' open tasks');
    if (state.data.source === 'demo') text += ' (demo data)';
    return h('p', { class: 'bj-sub', id: 'bj-count' }, text);
  }

  function render() {
    if (titleHandle) titleHandle.destroy();
    var title = h('h1', { class: 'ak-large-title' }, 'Backlog');
    // A failed refresh keeps the old list on screen and shows the error above it.
    var stale = state.error && state.data
      ? h('div', { class: 'bj-state', role: 'alert', 'data-state': 'error' }, h('div', { class: 'ak-empty' }, state.error))
      : null;
    app.replaceChildren(h('div', { class: 'bj-head' }, title), subtitle(), filterBar(), stale, content());
    titleHandle = AppKit.largeTitle(title);
  }

  /* ---------- start ---------- */

  AppKit.themeColor.start();
  AppKit.installPrompt.init({ appName: 'bujo', iconUrl: '/icons/icon-192.png' });
  AppKit.pullToRefresh({ onRefresh: function () { return load(); } });
  AppKit.sw.register({ url: '/sw.js', scope: '/' });

  render();
  load();
})();
