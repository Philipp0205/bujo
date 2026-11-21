/*
 * Shrinks a photo before it is stored with a note: at most 2000px on the long side, as a JPEG, drawn on a canvas.
 * Needs nothing else. The photo shows upright because createImageBitmap applies the EXIF orientation.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.photo = L.photo || {};

  var MAX_SIDE = 2000;
  var QUALITY = 0.85;
  var TYPE = 'image/jpeg';

  /** The size that fits max on its long side, keeping the shape. A smaller photo keeps its size. */
  function fit(width, height, max) {
    var long = Math.max(width, height);
    if (long <= max) return { width: width, height: height };
    var scale = max / long;
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
  }

  /** Draws the bitmap on a white canvas of the fitted size, so a transparent PNG does not turn black as a JPEG. */
  function draw(bitmap) {
    var size = fit(bitmap.width, bitmap.height, MAX_SIDE);
    var canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    var context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    return canvas;
  }

  function encode(canvas) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) { return blob ? resolve(blob) : reject(new Error('encode')); }, TYPE, QUALITY);
    });
  }

  /** A data: URL for a Blob. The page's CSP allows data: images, and a blob: URL it does not. */
  function dataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Resolves with { blob, url }: the shrunk JPEG to upload and a data: URL to show it.
   * Resolves with null when the browser cannot read the photo (a HEIC on Chrome), so the note is still saved, without a photo.
   */
  function shrink(file) {
    if (!window.createImageBitmap) return Promise.resolve(null);
    return window.createImageBitmap(file, { imageOrientation: 'from-image' }).then(function (bitmap) {
      var canvas = draw(bitmap);
      if (bitmap.close) bitmap.close();
      return encode(canvas);
    }).then(function (blob) {
      return dataUrl(blob).then(function (url) { return { blob: blob, url: url }; });
    }).then(null, function () { return null; });
  }

  L.photo.shrink = shrink;
  L.photo.fit = fit;
})();
