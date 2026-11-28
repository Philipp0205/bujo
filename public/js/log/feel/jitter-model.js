/*
 * Pure model of the small imperfections of handwriting: a slight tilt and a baseline lift per entry, from a hash of its id.
 * jitter(id) gives { rot (degrees), y (pixels) }. The same id always gives the same values, so a reload never moves a word.
 * No DOM, no strings.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.feel = L.feel || {};

  var MAX_ROT = 0.6;
  var MAX_Y = 0.8;

  /** A 32 bit FNV-1a hash of a string. */
  function hash(text) {
    var value = 2166136261;
    for (var index = 0; index < text.length; index++) {
      value ^= text.charCodeAt(index);
      value = Math.imul(value, 16777619) >>> 0;
    }
    return value;
  }

  /** A number from -1 to 1 for a seed string, spread evenly. */
  function signed(seed) {
    var mixed = hash(seed);
    mixed = Math.imul(mixed ^ (mixed >>> 15), 2246822507) >>> 0;
    return (mixed / 4294967295) * 2 - 1;
  }

  /** The tilt and lift of one entry, rounded to two decimals. */
  function jitter(id) {
    var key = String(id);
    return {
      rot: Math.round(signed('rot:' + key) * MAX_ROT * 100) / 100,
      y: Math.round(signed('y:' + key) * MAX_Y * 100) / 100
    };
  }

  L.feel.jitterModel = { MAX_ROT: MAX_ROT, MAX_Y: MAX_Y, jitter: jitter };
})();
