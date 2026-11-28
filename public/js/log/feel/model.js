/*
 * Pure model of the sound and haptic cues: what a cue does for a given state. Off unless the person turned it on. No DOM, no strings, no storage.
 * plan(state, kind) gives { haptic: milliseconds (0 for none), sound: voice name or null }. state: { enabled, reducedMotion, hidden, canVibrate }.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.feel = L.feel || {};

  var KEY = 'bujo-feedback';

  /** What each cue is: how long the tick lasts and which voice plays. A swipe lock is a tick with no sound. */
  var CUES = {
    check: { haptic: 10, sound: 'tick' },
    turn: { haptic: 8, sound: 'rustle' },
    lock: { haptic: 10, sound: null }
  };

  /** True only for the saved word "on": a missing, odd or unreadable value means off. */
  function parse(raw) {
    return raw === 'on';
  }

  /** The word to save for a choice. */
  function serialize(enabled) {
    return enabled ? 'on' : 'off';
  }

  /** What a cue does now. Nothing unless enabled and the page is shown; no sound with reduced motion; no tick where the device cannot vibrate. */
  function plan(state, kind) {
    var cue = CUES[kind];
    var none = { haptic: 0, sound: null };
    if (!cue || !state.enabled || state.hidden) return none;
    return {
      haptic: state.canVibrate ? cue.haptic : 0,
      sound: state.reducedMotion ? null : cue.sound
    };
  }

  L.feel.model = { KEY: KEY, KINDS: Object.keys(CUES), parse: parse, serialize: serialize, plan: plan };
})();
