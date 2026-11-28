/*
 * The one call the app makes for a cue: cue('check' | 'turn' | 'lock'). It reads the saved choice, the reduced-motion setting and whether the
 * page is shown, asks feel/model.js what to do, then vibrates and plays. Quiet unless the person turned it on. Never throws.
 * Needs feel/model.js, feel/store.js and feel/sound.js.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.feel = L.feel || {};

  /** The facts the decision needs, read now. */
  function state() {
    return {
      enabled: L.feel.store.read(),
      hidden: document.hidden === true,
      reducedMotion: !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches),
      canVibrate: typeof navigator.vibrate === 'function'
    };
  }

  /** A short tick on a device that can vibrate. */
  function buzz(ms) {
    if (!ms) return;
    try { navigator.vibrate(ms); } catch (error) { /* a tick is a nicety */ }
  }

  /** Does what a cue calls for in the current state. */
  function cue(kind) {
    var plan = L.feel.model.plan(state(), kind);
    buzz(plan.haptic);
    if (plan.sound) L.feel.sound.play(plan.sound);
  }

  L.feel.feedback = { cue: cue };
})();
