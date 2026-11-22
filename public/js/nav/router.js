/*
 * The same-document router of the three tab pages (Rapid log, Notes, Account). Each tab is still its own HTML file, so a cold
 * load or a shared link works as before. Once one tab page is showing, a tap on another tab stays in this document: the tab bar
 * stays mounted, the page's main is added once (nav/pages.js) and shown or hidden after that, so a return is instant and keeps
 * its scroll position. No cross-document view transitions: the incoming page only fades in (AppKit.tabbar.animatePage).
 *
 * History (the rules in the header of nav/tabs.js): leaving the log pushes an entry, Notes and Account replace each other, a tap
 * on Rapid log goes back when the entry before is the log (the popstate then shows the log), else it replaces the entry.
 * The overlay Back (nav/overlays.js, ak-nav.js) is not touched: its entries keep the page's address, so they change no tab.
 * A tab that cannot be shown here (its files fail to load, the session is gone) falls back to the old full navigation.
 *
 * A tab page's boot calls start(id, view) once. view = { show(ctx), scan(), add(), warm() }: show runs each time the tab comes to the
 * front (ctx.scan asks the log to start a scan, ctx.add to open a new entry), scan and add are what a scan link and the Add tab
 * do on that page, warm gets the tab ready (data in the cache, the editor set up) while another tab is on screen. The page that was loaded cold also gets the one-time setup here (theme colour, service worker, the
 * bar) and its first show. Needs nav/pages.js, nav/tabs.js, ak-tabbar.js. Nothing here knows what a tab looks like.
 */
(function () {
  'use strict';

  var N = window.BujoNav = window.BujoNav || {};

  var FILES = { log: '/index.html', notes: '/notes.html', account: '/settings.html' };
  /** The element each page is built around. A page's container is the top-level node of the body that holds it. */
  var HOSTS = { log: '#log', notes: '#notes', account: '#app' };
  var BACK_WAIT_MS = 400;
  var WARM_DELAY_MS = 400;
  var HOLD_FOCUS_MS = 4000;

  var views = {};
  var titles = {};
  var scrolls = {};
  var current = null;
  var seq = 0;

  /** Which tab an address belongs to, or null (the router leaves other addresses alone). */
  function idOf(pathname) {
    var path = pathname.replace(/\/+$/, '') || '/';
    return Object.keys(N.tabs.PATHS).filter(function (id) { return N.tabs.PATHS[id] === path || FILES[id] === path; })[0] || null;
  }

  /** The top-level body node of a tab's page, or null when the page was never added to this document. */
  function container(id) {
    var node = document.querySelector(HOSTS[id]);
    while (node && node.parentNode !== document.body) node = node.parentNode;
    return node;
  }

  function isReady(id) {
    return !!(views[id] && container(id));
  }

  /** Runs done at once when the tab's page is in this document, else adds it first. fail runs when it cannot be added. */
  function whenReady(id, done, fail) {
    if (isReady(id)) return done();
    N.pages.ensure(FILES[id], HOSTS[id]).then(function (page) {
      titles[id] = page.title;
      if (isReady(id)) done(); else fail();
    }, fail);
  }

  /** Puts a tab on screen: the old page is hidden with its scroll kept, the new one shown, the bar and the title follow. */
  function swap(to, ctx) {
    var from = current;
    if (from && from !== to) {
      scrolls[from] = window.pageYOffset;
      container(from).hidden = true;
    }
    var next = container(to);
    next.hidden = false;
    current = to;
    if (to === 'log') N.tabs.remember(false);
    if (titles[to]) document.title = titles[to];
    window.scrollTo(0, scrolls[to] || 0);
    N.tabs.mark(to);
    views[to].show(ctx || {});
    AppKit.tabbar.animatePage(next);
  }

  /** The old way: a full document load. Only for a tab that cannot be shown in place. */
  function hardGo(to, ctx) {
    var tabs = N.tabs;
    if (ctx.scan) window.location.assign(tabs.SCAN_URL);
    else if (current === 'log') { tabs.remember(true); window.location.assign(tabs.PATHS[to]); }
    else if (to === 'log' && tabs.logIsBefore()) { tabs.remember(false); window.history.back(); }
    else window.location.replace(tabs.PATHS[to]);
  }

  /** Goes one entry back to the log. When no popstate follows (the entry before is not what was remembered) the log replaces the page. */
  function backToLog() {
    var mine = seq;
    N.tabs.remember(false);
    window.history.back();
    window.setTimeout(function () {
      if (mine !== seq || current === 'log') return;
      window.history.replaceState(window.history.state, '', N.tabs.PATHS.log);
      swap('log', {});
    }, BACK_WAIT_MS);
  }

  /** Changes history the way that keeps Back short, then shows the tab. A step back shows it from the popstate instead. */
  function navigate(to, ctx) {
    var tabs = N.tabs;
    if (current === 'log' && to !== 'log') {
      tabs.remember(true);
      window.history.pushState(null, '', tabs.PATHS[to]);
    } else if (to === 'log' && (ctx.scan || ctx.add)) {
      // A scan or an add must show the log in this very turn (the tap's keyboard or camera), so no step back in history.
      window.history.pushState(null, '', tabs.PATHS.log);
    } else if (to === 'log' && tabs.logIsBefore()) {
      return backToLog();
    } else {
      window.history.replaceState(window.history.state, '', tabs.PATHS[to]);
    }
    swap(to, ctx);
  }

  /** Goes to a tab. ctx.scan (log only) starts the scan flow there. A newer call cancels one that is still loading. */
  function go(to, ctx) {
    var options = ctx || {};
    if (to === current || !N.tabs.PATHS[to]) return;
    var mine = ++seq;
    whenReady(to, function () {
      if (mine === seq) navigate(to, options);
    }, function () {
      if (mine === seq) hardGo(to, options);
    });
  }

  /** A scan request (a ?scan=1 link, or code): the page's own scan when it has one, else the log, which starts it. No tab calls it any more. */
  function scan() {
    var view = views[current];
    if (view && view.scan) view.scan();
    else go('log', { scan: true });
  }

  /** Moves the focus into a hidden field inside the tap, so the soft keyboard can open while the log is still loading. The editor takes the focus on. */
  function holdFocus() {
    var field = document.createElement('textarea');
    field.setAttribute('aria-hidden', 'true');
    field.tabIndex = -1;
    Object.assign(field.style, { position: 'fixed', top: '0', left: '0', width: '1px', height: '1px', opacity: '0', fontSize: '16px' });
    document.body.appendChild(field);
    field.focus({ preventScroll: true });
    window.setTimeout(function () { field.remove(); }, HOLD_FOCUS_MS);
  }

  /** The Add tab: the page's own new entry when it has one, else the log, which opens it. With the log in the document this runs
   * in the tap itself (go is synchronous then), which is what lets the keyboard open. */
  function add() {
    var view = views[current];
    if (view && view.add) { view.add(); return; }
    if (!isReady('log')) holdFocus();
    go('log', { add: true });
  }

  /** A step in history: shows the tab of the new address. Overlay entries and the first-entry stub are not tabs. */
  function onPop(event) {
    var state = event.state;
    if (state && (state.bujoStub || state.akOverlay)) return;
    var id = idOf(window.location.pathname);
    if (!id || id === current) return;
    var mine = ++seq;
    whenReady(id, function () {
      if (mine !== seq) return;
      if (id !== 'log' && state && state.bujoPage) N.tabs.remember(true);
      swap(id, {});
    }, function () {
      if (mine === seq) window.location.reload();
    });
  }

  /** Back landed on the stub under a first-entry page (see page-back.js): shows the log here. False when it is not loaded yet. */
  function leaveStub() {
    if (!isReady('log')) return false;
    seq += 1;
    window.history.replaceState(null, '', N.tabs.PATHS.log);
    swap('log', {});
    return true;
  }

  /** Adds the other tabs in the background, one after the other, and reads their data into the cache, so the first tap is a swap. */
  function warm() {
    var chain = Promise.resolve();
    Object.keys(FILES).filter(function (id) { return id !== current; }).forEach(function (id) {
      chain = chain.then(function () { return N.pages.ensure(FILES[id], HOSTS[id]); }).then(function (page) {
        titles[id] = page.title;
        if (views[id] && views[id].warm) return views[id].warm();
      }).then(null, function () { /* a tap will try again, or fall back to a full load */ });
    });
  }

  /** Warms once the page is quiet, so a cold load is never slowed by the other tabs. */
  function warmWhenIdle() {
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(warm, { timeout: 2000 });
    else window.setTimeout(warm, WARM_DELAY_MS);
  }

  /** The one-time setup of the document that was loaded cold: theme colour, service worker, the bar, Back, then the first show. */
  function coldStart(id) {
    current = id;
    titles[id] = document.title;
    AppKit.themeColor.start();
    AppKit.sw.register({ url: '/sw.js', scope: '/' });
    N.tabs.mount(id);
    window.addEventListener('popstate', onPop);
    views[id].show({});
    if (document.readyState === 'complete') warmWhenIdle();
    else window.addEventListener('load', warmWhenIdle);
  }

  /** A tab page's boot: registers its view. The page that was loaded cold also sets the document up and shows itself. */
  function start(id, view) {
    views[id] = view;
    if (current === null) coldStart(id);
  }

  N.router = { start: start, go: go, scan: scan, add: add, leaveStub: leaveStub };
})();
