/*
 * Daily log copy: every string the person reads, in one place. Plain JS, no build step.
 * Logic files take their words from here.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};

  L.copy = {
    title: 'Daily Log',
    today: 'Today',
    addEntry: '+ Add entry',
    notSynced: 'not synced',
    queued: 'waiting to send',
    done: {
      /** The accessible name of the bullet button, by the entry's current type: what a tap on it does. */
      toggle: { task: 'Mark as done', done: 'Mark as not done' }
    },
    offline: {
      hint: 'You\u2019re offline. New entries will be sent when you are back.',
      dropped: function (title) { return 'Could not send \u201c' + title + '\u201d. The server refused it.'; },
      droppedChange: 'Could not send a change. The server refused it.'
    },
    pages: {
      prev: 'Previous page',
      next: 'Next page',
      folio: function (number) { return 'Page ' + number; },
      pickDay: 'Choose a day',
      toToday: 'Today',
      toTodayLabel: 'Back to today',
      picker: {
        label: 'Choose a day',
        prevMonth: 'Previous month',
        nextMonth: 'Next month',
        months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
        weekdays: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'],
        hasEntries: 'has entries'
      }
    },
    horizon: {
      switcherLabel: 'Log view',
      views: { future: 'Future', month: 'Month', daily: 'Daily' },
      titles: { daily: 'Daily Log', month: 'Monthly Log', future: 'Future Log' },
      futureHeading: 'Next six months',
      thisMonth: 'This month',
      thisMonthLabel: 'Back to this month',
      monthTasks: 'Month tasks',
      /** The English weekday initials in the order of Date.getUTCDay (Sunday first): Tuesday and Thursday are both T, Saturday and Sunday both S. */
      weekdayInitials: ['S', 'M', 'T', 'W', 'T', 'F', 'S'],
      /** The day number of a day on the monthly calendar, with no leading zero ("1", "22"). */
      dayNumber: function (iso) { return String(Number(iso.slice(8, 10))); },
      /** The single English weekday initial of a day on the monthly calendar ("M" for a Monday). */
      dayInitial: function (iso) { return L.copy.horizon.weekdayInitials[L.dates.weekdayIndex(iso)]; },
      bucketEmpty: 'Nothing here yet.',
      /** "December 2026": the month name is English, the year follows it. */
      monthName: function (month) {
        return L.copy.pages.picker.months[Number(month.slice(5, 7)) - 1] + ' ' + month.slice(0, 4);
      },
      /** The chip of a line filed under a month: the month name, with the year when it is not the year of its home. */
      chip: function (month, homeYear) {
        var name = L.copy.pages.picker.months[Number(month.slice(5, 7)) - 1];
        return month.slice(0, 4) === homeYear ? name : name + ' ' + month.slice(0, 4);
      }
    },
    move: {
      /** The accessible name of a trace row's glyph: what the line on this page says happened to the entry. */
      traceLabel: { migrated: 'Moved', scheduled: 'Scheduled' },
      chooserLabel: 'Choose where the entry goes',
      migrateTitle: 'Move to',
      scheduleTitle: 'Schedule for',
      thisDay: 'This day',
      today: 'Today',
      nextDay: 'Next day',
      pickDay: 'Pick a day',
      pickDayLabel: 'Day to move to',
      thisMonth: 'This month',
      futureHeading: 'Future months',
      /** The aria name of a future month chip: the full month name and year. */
      monthLabel: function (month) { return L.copy.horizon.monthName(month); }
    },
    loading: 'Turning the page\u2026',
    loadFailed: 'Could not load the log. Try again.',
    retry: 'Try again',
    typeLabels: {
      task: 'Task',
      note: 'Note',
      event: 'Event',
      done: 'Done',
      migrated: 'Moved',
      scheduled: 'Scheduled',
      dropped: 'Dropped'
    },
    important: {
      /** The toggle in the long-press type picker, and the spoken name of the * in the margin. */
      toggle: 'Important',
      mark: 'Important',
      hint: 'A * in the margin, like on paper'
    },
    paperPage: {
      /** The quiet break where the next physical page of a day starts, and its spoken name. */
      break: function (page) { return 'Page ' + page; },
      /** The quiet line under a page that is on paper: scan that page again to update its entries. */
      scanAgain: 'Scan this page again'
    },
    migrate: {
      /** The quiet line above today's log while earlier days still hold open tasks. */
      prompt: function (count) { return count === 1 ? '1 open task from earlier days' : count + ' open tasks from earlier days'; },
      promptAction: 'Migrate',
      /** The always-there line under the entries of a daily page. */
      link: 'Review earlier tasks',
      title: 'Migrate',
      progress: function (at, total) { return 'Task ' + at + ' of ' + total; },
      empty: 'Nothing to migrate. Every earlier task is dealt with.',
      emptySub: 'Nothing left to review',
      doneSub: 'Review finished',
      choicesLabel: 'What to do with this task',
      keep: 'Keep',
      keepHint: 'Move it to today',
      schedule: 'Schedule',
      scheduleHint: 'Pick a later day or month',
      drop: 'Drop',
      dropHint: 'Not relevant any more',
      keepAll: 'Keep all remaining',
      close: 'Close',
      kept: function (count) { return count + ' kept'; },
      scheduled: function (count) { return count + ' scheduled'; },
      dropped: function (count) { return count + ' dropped'; }
    },
    remind: {
      monthly: {
        text: 'Migration is done. Take a look at the monthly log too.',
        open: 'Open the monthly log',
        later: 'Not now'
      },
      future: {
        title: 'A new month',
        sub: 'First open this month',
        text: 'Take a moment to check the future log.',
        open: 'Open the future log',
        later: 'Not now'
      }
    },
    sync: {
      local: 'Not synced',
      pending: 'Waiting to sync',
      synced: 'Synced',
      error: 'Sync failed'
    },
    inline: {
      titleLabel: 'Entry title',
      sheetLabel: 'Entry editor',
      barLabel: 'Entry options',
      typeMarker: function (label) { return 'Entry type: ' + label; },
      typeChooser: 'Choose an entry type',
      keys: {
        done: 'Done',
        next: 'Next line',
        tag: 'Tag',
        date: 'Date',
        time: 'Time',
        copy: 'Copy entry',
        remove: 'Delete entry',
        up: 'Move up',
        down: 'Move down',
        indent: 'Indent',
        outdent: 'Indent back',
        details: 'Details'
      },
      popLabels: { tag: 'Tags', date: 'Day', time: 'Time (optional)' },
      clear: 'Clear',
      tagSearch: 'Find or add a tag',
      tagSearchLabel: 'Search tags',
      tagList: 'Your tags',
      tagNone: 'No tags yet. Type one to add it.',
      tagAdd: function (text) { return '+ #' + text; },
      tagsFull: 'An entry holds at most 10 tags.'
    },
    suggest: {
      label: 'Suggestions',
      useTag: function (text) { return 'use ' + text; },
      weekdays: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'],
      monthHint: 'whole month',
      relative: { heute: 'heute', morgen: 'morgen', '\u00fcbermorgen': '\u00fcbermorgen' },
      weekdayNames: {
        montag: 'Montag', dienstag: 'Dienstag', mittwoch: 'Mittwoch', donnerstag: 'Donnerstag',
        freitag: 'Freitag', samstag: 'Samstag', sonntag: 'Sonntag'
      }
    },
    clip: {
      /** The German weekday of the day headers in copied text, in the order of Date.getUTCDay (Sunday first). */
      weekdays: ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'],
      /** The German month names of the headers of month and future entries in copied text. */
      months: ['Januar', 'Februar', 'M\u00e4rz', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'],
      copied: function (count) { return 'Copied ' + count; },
      failed: 'Could not copy. Try again.'
    },
    paper: {
      open: 'Not on paper',
      openLabel: function (count) { return count + ' not on paper yet. Open the list.'; },
      mark: 'Not on paper yet',
      heading: 'Not on paper',
      sub: function (count) { return count === 1 ? '1 entry to write down' : count + ' entries to write down'; },
      subEmpty: 'Nothing left to write down',
      empty: 'Everything is on paper.',
      offerPrompt: 'Scan the page to check it against the app?',
      offerScan: 'Scan the page',
      offerDismiss: 'Not now',
      failed: 'Could not load the list. Try again.',
      copyAll: 'Copy all',
      written: 'Mark as written',
      migrate: 'Migrate earlier tasks',
      writtenFailed: 'Could not mark it. Try again.'
    },
    select: {
      barLabel: 'Selection',
      count: function (count) { return count + ' selected'; },
      cancel: 'Cancel',
      day: 'Select day',
      copy: 'Copy'
    },
    sheet: {
      editTitle: 'Edit entry',
      type: 'Type',
      title: 'Title',
      tag: 'Tags (separated by spaces)',
      date: 'Date',
      time: 'Time (optional)',
      sync: 'Sync',
      save: 'Save',
      saving: 'Saving\u2026',
      retrySync: 'Retry sync',
      syncErrorFallback: 'The sync did not finish.'
    },
    errors: {
      titleRequired: 'Give the entry a title.',
      dateRequired: 'Pick a date.',
      saveFailed: 'Could not save. Try again.',
      lineFailed: 'Could not save this line. Try again.',
      actionFailed: 'Could not do that. Try again.',
      retryFailed: 'Could not retry the sync. Try again.'
    },
    into: {
      pickerLabel: 'Note',
      pickerHint: 'add as a line',
      title: 'Add as a line on a note',
      loading: 'Looking for your notes\u2026',
      empty: 'No free-form notes yet. Write a new note first, then add the task to it.',
      newNote: 'New note',
      loadFailed: 'Could not load your notes.',
      added: 'Added to the note',
      failed: 'Could not add it to the note. Try again.'
    },
    note: {
      untitled: 'Untitled note',
      savedHeading: 'Note',
      savedSub: 'Saved in your log',
      newHeading: 'New note',
      newSub: 'Write as many lines as you like.',
      dayHint: 'Tap to change the day',
      title: 'Title',
      date: 'Date',
      body: 'Markdown',
      saving: 'Saving\u2026',
      copy: 'Copy markdown',
      copied: 'Copied',
      copyFailed: 'Could not copy. Select the text and copy it by hand.',
      photoLabel: 'Scanned page',
      photoAlt: 'Photo of the scanned page',
      photoOpen: 'Open the photo full size',
      photoClose: 'Close the photo',
      photoFailed: 'The note is saved, but its photo could not be stored. Tap Save to try again.',
      titleRequired: 'Give the note a title.',
      dateRequired: 'Pick a date.',
      bodyRequired: 'Write something in the note.',
      saveFailed: 'Could not save the note. Try again.',
      scanAgain: 'Scan again',
      save: 'Save'
    }
  };
})();
