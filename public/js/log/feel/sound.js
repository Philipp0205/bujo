/*
 * The two soft voices of the journal, made with the Web Audio API (no audio files): a pen tick and a paper rustle, both short and quiet.
 * The audio context is made on the first cue, which always comes from a tap or a swipe, so the browser lets it start. Never throws.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.feel = L.feel || {};

  /** Each voice is a burst of noise through a band filter: its length, its pitch, its width and its (low) level. */
  var VOICES = {
    tick: { seconds: 0.035, freq: 1900, q: 1.4, gain: 0.07 },
    rustle: { seconds: 0.12, freq: 4800, q: 0.6, gain: 0.04 }
  };

  var context = null;

  /** The audio context, made on first use, or null where there is none. */
  function audio() {
    if (context) return context;
    var Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    context = new Ctor();
    return context;
  }

  /** A buffer of white noise of the given length. */
  function noise(ctx, seconds) {
    var length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    var buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    var data = buffer.getChannelData(0);
    for (var index = 0; index < length; index++) data[index] = Math.random() * 2 - 1;
    return buffer;
  }

  /** Starts one voice now: noise, a band filter, and a level that dies away fast. */
  function start(ctx, voice) {
    var source = ctx.createBufferSource();
    var filter = ctx.createBiquadFilter();
    var level = ctx.createGain();
    var now = ctx.currentTime;
    source.buffer = noise(ctx, voice.seconds);
    filter.type = 'bandpass';
    filter.frequency.value = voice.freq;
    filter.Q.value = voice.q;
    level.gain.setValueAtTime(voice.gain, now);
    level.gain.exponentialRampToValueAtTime(0.0001, now + voice.seconds);
    source.connect(filter);
    filter.connect(level);
    level.connect(ctx.destination);
    source.start(now);
  }

  /** Plays a voice by name. A failure is a missing nicety, never an error. */
  function play(name) {
    var voice = VOICES[name];
    if (!voice) return;
    try {
      var ctx = audio();
      if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume();
      start(ctx, voice);
    } catch (error) { /* a sound is a nicety */ }
  }

  L.feel.sound = { VOICES: VOICES, play: play };
})();
