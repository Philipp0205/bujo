/*
 * The autocomplete of the typed line: finds the "#tag" or "@date" word at the caret, asks for options, shows them in the strip
 * and runs the pick. Application logic only; the nodes are suggest/strip.js. Needs suggest/{token,options,pool,strip}.js.
 *
 * config: entries() the entries on screen, today(), shifted() the sheet changed height, picked(option, token) a tap or Enter on one.
 * Arrow Down and Up move a highlight (none to start with). Enter takes the highlighted option, and with none highlighted it
 * is left alone, so it saves the line as before.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.inline = L.inline || {};

  var config = null;
  var options = [];
  var token = null;
  var current = -1;

  /** Builds the strip for the sheet. */
  function init(settings) {
    config = settings;
    return L.suggest.strip.build(pick);
  }

  function isOpen() {
    return options.length > 0;
  }

  /** Empties and hides the strip. The sheet is told when its height changed. */
  function hide() {
    var was = isOpen();
    options = [];
    token = null;
    current = -1;
    L.suggest.strip.hide();
    if (was) config.shifted();
  }

  /** Looks at the word at the caret of the title input and shows its options, or hides the strip when there are none. */
  function update(line, input, composing) {
    var caret = input ? input.selectionStart : -1;
    var found = line && !composing && caret === input.selectionEnd ? L.suggest.token.at(input.value, caret) : null;
    var list = found ? L.suggest.options.optionsFor(found, line, L.suggest.pool.items(config.entries()), config.today()) : [];
    if (!list.length) { hide(); return; }
    var was = isOpen();
    token = found;
    options = list;
    current = -1;
    L.suggest.strip.show(list);
    if (!was) config.shifted();
  }

  /** Takes the option at an index: the strip closes and the editor puts it into the line. */
  function pick(index) {
    var option = options[index];
    var word = token;
    if (!option) return;
    hide();
    config.picked(option, word);
  }

  /** Arrow keys and Enter while the strip is open. True when the key was used. */
  function key(event) {
    if (!isOpen()) return false;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      var step = event.key === 'ArrowDown' ? 1 : -1;
      current = current < 0 ? (step > 0 ? 0 : options.length - 1) : (current + step + options.length) % options.length;
      L.suggest.strip.highlight(current);
      event.preventDefault();
      return true;
    }
    if (event.key === 'Enter' && current >= 0) {
      event.preventDefault();
      pick(current);
      return true;
    }
    return false;
  }

  L.inline.complete = { init: init, update: update, hide: hide, key: key, isOpen: isOpen };
})();
