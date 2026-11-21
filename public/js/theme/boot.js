/*
 * Theme boot: reads the saved theme choice and sets html[data-ak-scheme] before the first paint.
 * It is a plain synchronous script in <head>, ahead of the stylesheets, so the page never flashes the wrong paper.
 * (An external file, because the CSP only allows script-src 'self'.) ES5 on purpose: it must run everywhere, first.
 * Values: "system" (follow the OS, the default), "light", "dark". Anything else, or a storage error, means "system".
 */
(function (root) {
  var KEY = "bujo-theme";
  var CHOICES = ["system", "light", "dark"];

  // Reads the saved choice, falling back to "system" when it is missing, invalid or storage is blocked.
  function read() {
    try {
      var v = root.localStorage.getItem(KEY);
      return CHOICES.indexOf(v) >= 0 ? v : "system";
    } catch (e) {
      return "system";
    }
  }

  // Forces a scheme on <html>, or removes the override so the OS preference decides.
  function apply(choice) {
    var el = root.document.documentElement;
    if (choice === "light" || choice === "dark") el.setAttribute("data-ak-scheme", choice);
    else el.removeAttribute("data-ak-scheme");
  }

  // Saves the choice. A blocked storage is not an error: the choice then lasts until the page closes.
  function save(choice) {
    try {
      root.localStorage.setItem(KEY, choice);
    } catch (e) {}
  }

  // Applies and saves a choice, then asks the kit to re-read the page colour for the browser bar.
  function choose(choice) {
    if (CHOICES.indexOf(choice) < 0) choice = "system";
    save(choice);
    apply(choice);
    if (root.AppKit && root.AppKit.themeColor && root.AppKit.themeColor.start) root.AppKit.themeColor.start();
    return choice;
  }

  apply(read());
  // A page restored from the back-forward cache keeps its old attribute, so apply again when it comes back.
  root.addEventListener("pageshow", function () { apply(read()); });

  root.BujoTheme = { read: read, apply: apply, save: save, choose: choose, choices: CHOICES };
})(window);
