/*
 * The suggestion strip: one row of tappable options between the typed line and the accessory bar, for the "#tag" or "@date" word
 * at the caret. It builds and shows nodes and reports a tap, nothing else. Needs ak-dom.js and copy.js.
 * Options are { kind, label, hint }. A press never takes the focus off the title (the editor stops the mousedown), so the keyboard stays up.
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};
  L.suggest = L.suggest || {};

  var node = null;

  /** One option as a button: its label, and a quiet hint ("morgen") after it when there is one. */
  function optionButton(option, index) {
    return h('button', {
      class: 'suggest-opt', type: 'button', role: 'option', 'data-kind': option.kind, 'data-index': String(index), 'aria-selected': 'false'
    },
      h('span', { class: 'suggest-label' }, option.label),
      option.hint ? h('span', { class: 'suggest-hint' }, option.hint) : null);
  }

  /** Builds the strip once, hidden. onPick(index) runs when an option is tapped. */
  function build(onPick) {
    node = h('div', { class: 'suggest-strip', role: 'listbox', 'aria-label': L.copy.suggest.label, 'data-testid': 'suggest-strip', hidden: true });
    node.addEventListener('click', function (event) {
      var button = event.target.closest('.suggest-opt');
      if (button) onPick(Number(button.getAttribute('data-index')));
    });
    return node;
  }

  /** Marks one option as the highlighted one (or none, with -1) and keeps it in view. */
  function highlight(index) {
    Array.prototype.forEach.call(node.children, function (button, at) {
      button.setAttribute('aria-selected', at === index ? 'true' : 'false');
      if (at === index && button.scrollIntoView) button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  }

  /** Shows these options, none highlighted. */
  function show(options) {
    node.replaceChildren.apply(node, options.map(optionButton));
    node.scrollLeft = 0;
    node.hidden = false;
  }

  /** Hides the strip and empties it. */
  function hide() {
    if (!node) return;
    node.hidden = true;
    node.replaceChildren();
  }

  L.suggest.strip = { build: build, show: show, hide: hide, highlight: highlight, isOpen: function () { return !!node && !node.hidden; } };
})();
