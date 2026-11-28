/*
 * Pure model of the note under a review row: one short line that says how the line relates to the app.
 * No DOM. The words come from scan/copy.js. Needs scan/copy.js and scan/model.js.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.scan = L.scan || {};

  /** The title of the entry a line is matched to, as it is in the app (or ''). */
  function oldTitleOf(item, match) {
    var fields = L.scan.model.changedFields(item);
    if (fields) return fields.title;
    return match && match.kind === 'entry' ? match.title : '';
  }

  /** True when the app's title differs from the line's title, so the old text is worth showing. */
  function titleChanged(item, match) {
    var old = oldTitleOf(item, match).trim();
    return old !== '' && old !== item.title.trim();
  }

  /** The first words when the matched entry's text differs: its old bullet and title, and what the paper turns it into. */
  function wasPart(item, match) {
    var copy = L.copy.scan.review;
    var fields = L.scan.model.changedFields(item);
    var type = fields ? fields.type : (item.target && item.target.type);
    return copy.was(type, oldTitleOf(item, match), copy.changeTo[L.scan.model.changeKey(item)]);
  }

  /** The first words when nothing differs: "matches" and what applying does (a line that already matches says only that). Nothing for a new line. */
  function matchPart(item, match) {
    var copy = L.copy.scan.review;
    if (!match) return [];
    var key = L.scan.model.changeKey(item);
    if (match.kind === 'trace') return [copy.traceChange];
    if (match.kind === 'entry' && key === 'same') return [copy.matchChange.same];
    var change = match.kind === 'moved' ? copy.movedFrom(match.date) : copy.matchChange[key];
    return [copy.matches, change];
  }

  /** The leading parts of the note: the un-match words, the old state, or what the line matches and the change. */
  function leadParts(item, match) {
    var copy = L.copy.scan.review;
    if (item.unmatched) return [item.wasMatch ? copy.notMatched(item.wasMatch.title) : ''];
    if (match && match.kind === 'entry' && titleChanged(item, match)) return [wasPart(item, match)];
    return matchPart(item, match);
  }

  /** The trailing facts: a hint for a hard to read line, the time (and the old one), importance, a move, and a change made in the app. */
  function factParts(item) {
    var copy = L.copy.scan.review;
    var fields = L.scan.model.changedFields(item);
    var match = L.scan.model.matchOf(item);
    var parts = [];
    if (L.scan.model.isLowConfidence(item)) parts.push(copy.hardToRead);
    if (item.time) parts.push(item.time);
    if (fields && fields.time) parts.push(copy.timeWas(fields.time.value));
    if (item.important) parts.push(copy.important);
    if (match && match.kind === 'entry' && item.moveTo) parts.push(copy.movesTo(item.moveTo));
    if (item.status === 'edited' && item.contested) parts.push(copy.changedInApp);
    return parts;
  }

  /** The one note line of a row (empty when there is nothing to say): what the line matches and what applying does, then the facts. */
  function note(item) {
    var match = L.scan.model.matchOf(item);
    return leadParts(item, match).concat(factParts(item)).filter(function (part) { return part !== ''; }).join(', ');
  }

  /** True when the row can offer "Not the same": it matched something, or was un-matched from something. */
  function hasMatch(item) {
    return item.unmatched ? !!item.wasMatch : !!L.scan.model.matchOf(item);
  }

  L.scan.note = { note: note, hasMatch: hasMatch };
})();
