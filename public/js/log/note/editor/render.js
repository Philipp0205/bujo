/*
 * Pure Markdown renderer for free notes: text in, an HTML string out. No DOM, no strings to show.
 * It only emits known tags around escaped text, so a note can never inject markup, and only http, https, mailto and relative links get an href.
 * Subset: headings, **bold**, *italic*, [links](url), bullet, numbered and checkbox lists (flat, with an indent class), paragraphs with line breaks.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.note = L.note || {};
  L.note.editor = L.note.editor || {};

  var HEADING = /^(#{1,6})\s+(.+)$/;
  var ITEM = /^(\s*)([-*]|\d+\.) (\[([ xX])\] )?(.*)$/;
  var LINK = /\[([^\]]+)\]\(([^)\s]+)\)/;
  var MAX_DEPTH = 3;
  var SAFE_SCHEMES = /^(https?|mailto):/i;

  /** Escapes text for use in HTML content and in a double-quoted attribute. */
  function escape(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** True when a link target may become an href: a safe scheme, or no scheme at all (a relative link). */
  function safeUrl(url) {
    var clean = url.replace(/[\u0000-\u0020\u007f-\u009f]/g, '');
    if (SAFE_SCHEMES.test(clean)) return true;
    return !/^[a-z][a-z0-9+.\-]*:/i.test(clean);
  }

  /** Bold and italic on text that is already escaped (escaping adds no asterisks). */
  function emphasis(escaped) {
    return escaped
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*\s](?:[^*]*[^*\s])?)\*/g, '<em>$1</em>');
  }

  /** The anchor for a link, or only its text when the target is unsafe. */
  function anchor(text, url) {
    var inner = emphasis(escape(text));
    if (!safeUrl(url)) return inner;
    return '<a href="' + escape(url) + '" target="_blank" rel="noopener noreferrer">' + inner + '</a>';
  }

  /** Inline Markdown of one line: links first (they need the raw url), then emphasis on the escaped rest. */
  function inline(text) {
    var out = '';
    var rest = text;
    var match = LINK.exec(rest);
    while (match) {
      out += emphasis(escape(rest.slice(0, match.index))) + anchor(match[1], match[2]);
      rest = rest.slice(match.index + match[0].length);
      match = LINK.exec(rest);
    }
    return out + emphasis(escape(rest));
  }

  /** One list item as li HTML. A checkbox item shows a box glyph; its state is in data-checked. */
  function item(match) {
    var depth = Math.min(MAX_DEPTH, Math.floor(match[1].replace(/\t/g, '  ').length / 2));
    var cls = 'md-d' + depth + (match[3] ? ' md-task' : '');
    var attr = match[3] ? ' data-checked="' + (match[4] !== ' ') + '"' : '';
    var box = match[3] ? '<span class="md-box" aria-hidden="true">' + (match[4] !== ' ' ? '\u2611' : '\u2610') + '</span>' : '';
    return '<li class="' + cls + '"' + attr + '>' + box + inline(match[5]) + '</li>';
  }

  /** Reads a run of list items starting at index i. Returns the HTML and the next index. */
  function list(lines, i) {
    var ordered = /^\s*\d/.test(lines[i]);
    var html = '';
    var match = ITEM.exec(lines[i]);
    while (match && /^\s*\d/.test(lines[i]) === ordered) {
      html += item(match);
      i += 1;
      match = i < lines.length ? ITEM.exec(lines[i]) : null;
    }
    var tag = ordered ? 'ol' : 'ul';
    return { html: '<' + tag + '>' + html + '</' + tag + '>', next: i };
  }

  /** True for a line that starts a block of its own, so it ends a paragraph. */
  function isBlock(line) {
    return HEADING.test(line) || ITEM.test(line);
  }

  /** Reads a paragraph: consecutive plain lines joined by line breaks. */
  function paragraph(lines, i) {
    var parts = [];
    while (i < lines.length && lines[i].trim() !== '' && !isBlock(lines[i])) {
      parts.push(inline(lines[i].trim()));
      i += 1;
    }
    return { html: '<p>' + parts.join('<br>') + '</p>', next: i };
  }

  /** The block that starts at line i: heading, list or paragraph. */
  function block(lines, i) {
    var heading = HEADING.exec(lines[i]);
    if (heading) {
      var level = heading[1].length;
      var tag = 'h' + Math.min(6, level + 2);
      return { html: '<' + tag + ' class="md-h' + level + '">' + inline(heading[2].trim()) + '</' + tag + '>', next: i + 1 };
    }
    return ITEM.test(lines[i]) ? list(lines, i) : paragraph(lines, i);
  }

  /** Renders Markdown text to safe HTML. */
  function render(markdown) {
    var lines = String(markdown).replace(/\r\n?/g, '\n').split('\n');
    var html = '';
    var i = 0;
    while (i < lines.length) {
      if (lines[i].trim() === '') {
        i += 1;
        continue;
      }
      var part = block(lines, i);
      html += part.html;
      i = part.next;
    }
    return html;
  }

  L.note.editor.render = render;
})();
