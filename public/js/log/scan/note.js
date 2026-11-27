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

  /** The first words when nothing differs: the confidence (with "match" for a matched line) and what applying does. */
  function matchPart(item, match) {
    var copy = L.copy.scan.review;
    var percent = L.scan.model.percent(item);
    if (!match) return [copy.percent(percent)];
    var change = { entry: copy.matchChange[L.scan.model.changeKey(item)], moved: match.kind === 'moved' ? copy.movedFrom(match.date) : '', trace: copy.traceChange }[match.kind];
    return [copy.percentMatch(percent), change];
  }

  /** The leading parts of the note: the un-match words, the old state, or the confidence and the change. */
  function leadParts(item, match) {
    var copy = L.copy.scan.review;
    var percent = copy.percent(L.scan.model.percent(item));
    if (item.unmatched) return [percent, item.wasMatch ? copy.notMatched(item.wasMatch.title) : ''];
    if (match && match.kind === 'entry' && titleChanged(item, match)) return [wasPart(item, match)].concat(L.scan.model.isLowConfidence(item) ? [percent] : []);
    return matchPart(item, match);
  }

  /** The trailing facts: the time (and the old one), importance, a spelling hint, a move, and a change made in the app. */
  function factParts(item) {
    var copy = L.copy.scan.review;
    var fields = L.scan.model.changedFields(item);
    var match = L.scan.model.matchOf(item);
    var parts = [];
    if (item.time) parts.push(item.time);
    if (fields && fields.time) parts.push(copy.timeWas(fields.time.value));
    if (item.important) parts.push(copy.important);
    if (L.scan.model.isLowConfidence(item)) parts.push(copy.checkSpelling);
    if (match && match.kind === 'entry' && item.moveTo) parts.push(copy.movesTo(item.moveTo));
    if (item.status === 'edited' && item.contested) parts.push(copy.changedInApp);
    return parts;
  }

  /** The one note line of a row: confidence, what the line matches and what applying does, then the facts. */
  function note(item) {
    var match = L.scan.model.matchOf(item);
    return leadParts(item, match).concat(factParts(item)).filter(function (part) { return part !== ''; }).join(' \u00b7 ');
  }

  /** True when the row can offer "Not the same": it matched something, or was un-matched from something. */
  function hasMatch(item) {
    return item.unmatched ? !!item.wasMatch : !!L.scan.model.matchOf(item);
  }

  L.scan.note = { note: note, hasMatch: hasMatch };
})();
