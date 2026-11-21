/*
 * The tab pages as the router needs them. A tab page is still its own HTML file (a cold load and a shared link use it), so that
 * file stays the one list of what the page needs: its main element, its styles and its scripts. This reads the file and adds
 * whatever the open document is missing, so a tab can be shown without a document load. Same-origin only (CSP: script-src 'self').
 * BujoNav.pages.ensure(file, host) resolves with { title } once the page's main (hidden), styles and scripts are in the document.
 */
(function () {
  'use strict';

  var N = window.BujoNav = window.BujoNav || {};
  var STYLE_ANCHOR = '/css/tabs.css';

  var records = {};
  var loaded = {};

  /** Lists the attribute of every matching node of a parsed page. */
  function listOf(doc, selector, attribute) {
    return Array.prototype.map.call(doc.querySelectorAll(selector), function (node) { return node.getAttribute(attribute); });
  }

  /** What a page file says about itself: title, main element, sprite, styles and scripts, in the order of the file. */
  function parse(html) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    return {
      title: doc.title,
      main: doc.body.querySelector(':scope > main, :scope > .paper'),
      sprite: doc.querySelector('svg.paper-sprite'),
      styles: listOf(doc, 'link[rel="stylesheet"]', 'href'),
      scripts: listOf(doc, 'script[src]', 'src')
    };
  }

  /** Reads a page file once. A redirect means the session is gone (the sign-in page came back), which is no page for a tab. */
  function read(file) {
    if (!records[file]) {
      records[file] = fetch(file, { credentials: 'same-origin' }).then(function (response) {
        if (!response.ok || response.redirected) throw new Error('The page is not available.');
        return response.text();
      }).then(parse);
      records[file].then(null, function () { delete records[file]; });
    }
    return records[file];
  }

  /** Adds the styles the document does not have yet, before the tab bar's own file so the cascade stays as in the page file. */
  function addStyles(hrefs) {
    var anchor = document.querySelector('link[rel="stylesheet"][href="' + STYLE_ANCHOR + '"]');
    var missing = hrefs.filter(function (href) { return !document.querySelector('link[rel="stylesheet"][href="' + href + '"]'); });
    return Promise.all(missing.map(function (href) {
      return new Promise(function (resolve, reject) {
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        link.onload = resolve;
        link.onerror = reject;
        document.head.insertBefore(link, anchor);
      });
    }));
  }

  /** Adds the scripts the document does not have yet. They run in the order of the page file, not in the order they arrive. */
  function addScripts(srcs) {
    var missing = srcs.filter(function (src) { return !document.querySelector('script[src="' + src + '"]'); });
    return Promise.all(missing.map(function (src) {
      return new Promise(function (resolve, reject) {
        var script = document.createElement('script');
        script.async = false;
        script.src = src;
        script.onload = resolve;
        script.onerror = reject;
        document.body.appendChild(script);
      });
    }));
  }

  /** Puts the page's main into the document, hidden, unless the document has it already. The tab bar stays last. */
  function addMain(page, host) {
    if (document.querySelector(host)) return;
    var node = document.importNode(page.main, true);
    node.hidden = true;
    document.body.insertBefore(node, document.querySelector('.ak-tabbar'));
  }

  /** Makes the icons the page draws with (<use href="#g-...">) available: adds the sprite, or the symbols it lacks. */
  function addSymbols(page) {
    if (!page.sprite) return;
    var sprite = document.querySelector('svg.paper-sprite');
    if (!sprite) {
      document.body.insertBefore(document.importNode(page.sprite, true), document.body.firstChild);
      return;
    }
    Array.prototype.forEach.call(page.sprite.querySelectorAll('symbol'), function (symbol) {
      if (!document.getElementById(symbol.id)) sprite.appendChild(document.importNode(symbol, true));
    });
  }

  /** Brings a page into the document: styles first (so nothing shows unstyled), then main and icons, then scripts. Once per file. */
  function ensure(file, host) {
    if (!loaded[file]) {
      loaded[file] = read(file).then(function (page) {
        return addStyles(page.styles).then(function () {
          addMain(page, host);
          addSymbols(page);
          return addScripts(page.scripts);
        }).then(function () { return page; });
      });
      loaded[file].then(null, function () { delete loaded[file]; });
    }
    return loaded[file];
  }

  N.pages = { ensure: ensure };
})();
