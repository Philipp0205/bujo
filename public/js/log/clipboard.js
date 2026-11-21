/*
 * Copies log entries to the clipboard as paper lines and says so in a toast. Needs ak-dom.js, clip.js, toast.js and copy.js.
 * Resolves true when the text reached the clipboard. A failed copy shows the failure toast and resolves false, so the caller can stay where it is.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};

  /** Writes the text of the entries through the kit's copy (clipboard, then the textarea fallback) and shows the result. */
  function copy(entries) {
    var text = L.clip.format(entries);
    return Promise.resolve(AppKit.copyText(text)).then(function (ok) {
      if (ok) L.toast.show(L.copy.clip.copied(entries.length), 'ok');
      else L.toast.show(L.copy.clip.failed, 'fail');
      return !!ok;
    });
  }

  L.clipboard = { copy: copy };
})();
