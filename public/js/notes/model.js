/*
 * Notes model: turns the entries of GET /api/entries?kind=notes into cards, and cards into groups. Pure functions, no DOM,
 * so they can be tested alone. Groups follow the collection a note is filed on (entry.collectionId, the card's collectionId): a note
 * on none is in the group without a heading, which comes first. Needs log/paper/recent.js (the paper window).
 */
(function () {
  'use strict';

  var B = window.BujoNotes = window.BujoNotes || {};

  /**
   * One card per note: what the grid shows (title, whether a photo is stored), the collection it is filed on (as collectionId), and
   * whether it carries the "not on paper" mark: not on paper and dated inside the paper window (log/paper/recent.js).
   */
  function cards(entries, today) {
    return entries.map(function (entry) {
      return {
        id: entry.id,
        title: entry.title,
        hasPhoto: !!entry.hasPhoto,
        collectionId: entry.collectionId || null,
        onPaper: !!entry.onPaper,
        date: entry.date,
        unwritten: window.BujoLog.paper.recent.shows(entry, today)
      };
    });
  }

  /** Groups the cards by collection in first-seen order, with the cards that are in none first. Keeps each group's card order. */
  function groups(list) {
    var order = [];
    var byId = {};
    list.forEach(function (card) {
      var key = card.collectionId || '';
      if (!byId[key]) {
        byId[key] = { collectionId: card.collectionId, cards: [] };
        order.push(key);
      }
      byId[key].cards.push(card);
    });
    order.sort(function (a, b) { return (a === '' ? 0 : 1) - (b === '' ? 0 : 1); });
    return order.map(function (key) { return byId[key]; });
  }

  B.model = { cards: cards, groups: groups };
})();
