/*
 * Notes model: turns the entries of GET /api/entries?kind=notes into cards, and cards into groups. Pure functions, no DOM,
 * so they can be tested alone. Groups exist so notebooks can be added later: a card with a notebookId lands in a group of
 * its own, and today every card has none, which makes one group without a heading.
 */
(function () {
  'use strict';

  var B = window.BujoNotes = window.BujoNotes || {};

  /** One card per note: what the grid shows (title, whether a photo is stored) and the notebook it will belong to (none yet). */
  function cards(entries) {
    return entries.map(function (entry) {
      return { id: entry.id, title: entry.title, hasPhoto: !!entry.hasPhoto, notebookId: entry.notebookId || null };
    });
  }

  /** Groups the cards by notebook in first-seen order, with the cards that belong to none first. Keeps each group's card order. */
  function groups(list) {
    var order = [];
    var byId = {};
    list.forEach(function (card) {
      var key = card.notebookId || '';
      if (!byId[key]) {
        byId[key] = { notebookId: card.notebookId, cards: [] };
        order.push(key);
      }
      byId[key].cards.push(card);
    });
    order.sort(function (a, b) { return (a === '' ? 0 : 1) - (b === '' ? 0 : 1); });
    return order.map(function (key) { return byId[key]; });
  }

  B.model = { cards: cards, groups: groups };
})();
