/*
 * Font boot: reads the saved journal text face and sets html[data-font] before the first paint.
 * Like theme/boot.js it is a plain synchronous script in <head>, ahead of the stylesheets, so a reload never
 * flashes Newsreader first. The choice lives on this device only (localStorage), the server never sees it.
 * ES5 on purpose. Values: "newsreader" (the default), "literata", "source-serif", "lora". Anything else means "newsreader".
 */
(function (root) {
  var KEY = "bujo-font";
  var CHOICES = ["newsreader", "literata", "source-serif", "lora"];

  // Reads the saved choice, falling back to "newsreader" when it is missing, invalid or storage is blocked.
  function read() {
    try {
      var v = root.localStorage.getItem(KEY);
      return CHOICES.indexOf(v) >= 0 ? v : "newsreader";
    } catch (e) {
      return "newsreader";
    }
  }

  // Sets the face on <html>. Newsreader is the stylesheet default, so it needs no attribute.
  function apply(choice) {
    var el = root.document.documentElement;
    if (choice === "newsreader") el.removeAttribute("data-font");
    else el.setAttribute("data-font", choice);
  }

  // Saves the choice. A blocked storage is not an error: the choice then lasts until the page closes.
  function save(choice) {
    try {
      root.localStorage.setItem(KEY, choice);
    } catch (e) {}
  }

  // Saves and applies a choice at once.
  function choose(choice) {
    if (CHOICES.indexOf(choice) < 0) choice = "newsreader";
    save(choice);
    apply(choice);
    return choice;
  }

  apply(read());
  // A page restored from the back-forward cache keeps its old attribute, so apply again when it comes back.
  root.addEventListener("pageshow", function () { apply(read()); });

  root.BujoFont = { read: read, apply: apply, save: save, choose: choose, choices: CHOICES };
})(window);
