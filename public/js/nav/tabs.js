/*
 * The bottom tab bar (AppKit.tabbar) of the log, Notes and Settings pages. The kit does no routing: a tap goes to BujoNav.router,
 * which shows the tab in this document (nav/router.js has the history rules). The bar is mounted once, on the page that was loaded
 * cold, and mark() moves the active tab after that. This file keeps the history memory the router and page-back share: the log
 * is the home, so a tab opened from it is pushed (Back returns to the log), a switch between Notes and Account replaces the page
 * (no stack of tabs), and a tap on Rapid log goes back in history when the log is the entry before.
 * Add and Scan are actions, not pages: they never become the active tab. The router opens a new entry or the camera on the log.
 * Needs ak-tabbar.js, nav/copy.js and nav/icons.js. Load nav/page-back.js first on a page that can be opened first in the window.
 */
(function () {
  'use strict';

  var N = window.BujoNav = window.BujoNav || {};

  var ORDER = ['log', 'notes', 'add', 'scan', 'account'];
  var PATHS = { log: '/', notes: '/notes', account: '/settings' };
  /** The log with this query starts the scan flow at boot (see log/main.js). A shared link or the router's fallback uses it. */
  var SCAN_URL = '/?scan=1';
  /** Set while the history entry before the current page is the rapid log. Lives for the browser tab only. */
  var LOG_BEFORE = 'bujo-log-before';
  var bar = null;

  /** Keeps (or forgets) that the entry before the current page is the rapid log. */
  function remember(on) {
    try {
      if (on) window.sessionStorage.setItem(LOG_BEFORE, '1');
      else window.sessionStorage.removeItem(LOG_BEFORE);
    } catch (ignored) { /* private mode: the tab then replaces the page, which is still right */ }
  }

  function logIsBefore() {
    try { return window.sessionStorage.getItem(LOG_BEFORE) === '1'; } catch (ignored) { return false; }
  }

  /** The log was left by a tab (or page-back put a stub for the log under this page): the entry before this page is the log. */
  function noteHistory(active) {
    var state = window.history.state;
    if (active === 'log') remember(false);
    else if (state && state.bujoPage) remember(true);
  }

  /** The tab definitions, with their words and icons. */
  function tabs() {
    return ORDER.map(function (id) { return { id: id, label: N.copy.tabs[id], icon: N.icons.icon(id) }; });
  }

  /** A tap on a tab: Add and Scan are actions (they open an entry or the camera and return, no route), any other tab is shown by the router. */
  function select(id) {
    if (id === 'add') N.router.add();
    else if (id === 'scan') N.router.scan();
    else N.router.go(id);
  }

  /** Adds the bar to the page with this tab marked active. Returns the kit's bar. */
  function mount(active) {
    noteHistory(active);
    bar = AppKit.tabbar({
      tabs: tabs(),
      active: active,
      label: N.copy.barLabel,
      onSelect: select
    });
    document.body.appendChild(bar.el);
    document.documentElement.classList.add('has-tabbar');
    return bar;
  }

  /** Marks another tab as the current page, in the bar that is already there. */
  function mark(active) {
    if (bar) bar.update({ active: active });
  }

  N.tabs = { mount: mount, mark: mark, remember: remember, logIsBefore: logIsBefore, PATHS: PATHS, SCAN_URL: SCAN_URL };
})();
