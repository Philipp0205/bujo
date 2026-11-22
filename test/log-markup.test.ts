import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { addDays, dateOf, monthOf } from "../src/log/date-token.ts";
import { parseMarkup, type Markup, type MarkupOptions } from "../src/log/markup.ts";

type Browser = {
  markup: { parse: (text: string, options?: MarkupOptions) => Markup };
  dateToken: {
    of: (word: string, today: string) => string | null;
    monthOf: (word: string, today: string) => string | null;
    addDays: (iso: string, days: number) => string;
  };
};

/** The browser twins, loaded the way a page loads them: scripts that hang themselves on one window.BujoLog. */
function loadBrowser(): Browser {
  const window: { BujoLog?: Browser } = {};
  for (const file of ["date-token.js", "markup.js"]) {
    vm.runInNewContext(readFileSync(new URL(`../public/js/log/${file}`, import.meta.url), "utf8"), { window });
  }
  return window.BujoLog!;
}

/** A Saturday, so "@sa" is today, "@mo" is two days on and "@fr" is six. */
const TODAY = "2026-11-21";
const FINAL = { final: true, today: TODAY };
const LIVE = { final: false, today: TODAY };
const none = (title: string, tags: string[] = []): Markup => ({ title, tags, date: null, month: null, time: null });

test("final: written tags and a time leave the title", () => {
  assert.deepEqual(parseMarkup("Zahnarzt #health 14:30", FINAL), { title: "Zahnarzt", tags: ["health"], date: null, month: null, time: "14:30" });
  assert.deepEqual(parseMarkup("#work Mira anrufen", FINAL), { title: "Mira anrufen", tags: ["work"], date: null, month: null, time: null });
  assert.deepEqual(parseMarkup("Call 9:05 Mira", FINAL), { title: "Call Mira", tags: [], date: null, month: null, time: "09:05" });
});

test("final: every tag is kept in the order written, a repeat ignoring case is dropped with the first spelling kept", () => {
  assert.deepEqual(parseMarkup("x #a #b #c", FINAL).tags, ["a", "b", "c"]);
  assert.deepEqual(parseMarkup("x #Reise #work #reise #WORK #Küche", FINAL).tags, ["Reise", "work", "Küche"]);
  assert.equal(parseMarkup("x #Reise #work #reise", FINAL).title, "x");
});

test("final: time spellings are normalised to HH:MM", () => {
  const time = (text: string) => parseMarkup(text, FINAL).time;
  assert.equal(time("a 14h"), "14:00");
  assert.equal(time("a 9h30"), "09:30");
  assert.equal(time("a 14h30"), "14:30");
  assert.equal(time("a 9:00"), "09:00");
  assert.equal(time("a 23:59"), "23:59");
});

test("final: the last day and the last time win", () => {
  assert.deepEqual(parseMarkup("x #a #b 8:00 9:00", FINAL), { title: "x", tags: ["a", "b"], date: null, month: null, time: "09:00" });
  assert.deepEqual(parseMarkup("x @morgen @mo", FINAL), { title: "x", tags: [], date: "2026-11-23", month: null, time: null });
  assert.deepEqual(parseMarkup("x @mo @morgen", FINAL), { title: "x", tags: [], date: "2026-11-22", month: null, time: null });
});

test("final: a written day, tags and time are all cut out in one go", () => {
  assert.deepEqual(parseMarkup("Zahnarzt @morgen #Arzt #health 14:30", FINAL), {
    title: "Zahnarzt", tags: ["Arzt", "health"], date: "2026-11-22", month: null, time: "14:30",
  });
});

test("final: glued or odd words stay text", () => {
  const text = ["Plan #tag, soon", "foo#bar", "Call 14", "Frist 20.11.", "about 5h", "Zeit 24:00", "Zeit 9:60", "Platz #1", "# alone", "Sprint 3.5h", "mail@morgen", "heute", "@mo.", "@", "@xyz"];
  for (const line of text) assert.deepEqual(parseMarkup(line, FINAL), none(line), line);
});

test("final: a line that would be left with no title is kept as it is", () => {
  assert.deepEqual(parseMarkup("#home", FINAL), none("#home"));
  assert.deepEqual(parseMarkup("  #home 9:00  ", FINAL), none("#home 9:00"));
  assert.deepEqual(parseMarkup("@morgen", FINAL), none("@morgen"));
  assert.deepEqual(parseMarkup("#a @mo 9:00", FINAL), none("#a @mo 9:00"));
});

test("final: the title is trimmed and double spaces from cut words are not left behind", () => {
  assert.equal(parseMarkup("  a   #t   b  ", FINAL).title, "a   b");
  assert.equal(parseMarkup("a #t", FINAL).title, "a");
  assert.equal(parseMarkup("a @morgen b", FINAL).title, "a b");
});

test("a tag longer than the tag limit is plain text", () => {
  const long = `#${"t".repeat(41)}`;
  assert.deepEqual(parseMarkup(`x ${long}`, FINAL), none(`x ${long}`));
  assert.deepEqual(parseMarkup(`x #${"t".repeat(40)}`, FINAL).tags, ["t".repeat(40)]);
});

test("live: the word at the end of the text may still be growing, so it is left alone", () => {
  assert.deepEqual(parseMarkup("Zahnarzt #hea", LIVE), none("Zahnarzt #hea"));
  assert.deepEqual(parseMarkup("Zahnarzt 9:0", LIVE), none("Zahnarzt 9:0"));
  assert.deepEqual(parseMarkup("Zahnarzt @mo", LIVE), none("Zahnarzt @mo"));
  assert.deepEqual(parseMarkup("Zahnarzt #health ", LIVE), none("Zahnarzt ", ["health"]));
  assert.deepEqual(parseMarkup("Zahnarzt 14:30 ", LIVE), { title: "Zahnarzt ", tags: [], date: null, month: null, time: "14:30" });
  assert.deepEqual(parseMarkup("Zahnarzt @mo ", LIVE), { title: "Zahnarzt ", tags: [], date: "2026-11-23", month: null, time: null });
  assert.deepEqual(parseMarkup("#home ", LIVE), none("", ["home"]));
});

test("the default is a live parse", () => {
  assert.deepEqual(parseMarkup("x #a"), parseMarkup("x #a", { final: false }));
});

test("dates: false leaves an @ word in the title", () => {
  assert.deepEqual(parseMarkup("Zahnarzt @morgen #Arzt", { ...FINAL, dates: false }), { title: "Zahnarzt @morgen", tags: ["Arzt"], date: null, month: null, time: null });
  assert.deepEqual(parseMarkup("Urlaub @dez", { ...FINAL, dates: false }), none("Urlaub @dez"), "month words are dates too");
});

test("date words: relative words, weekdays and their short forms", () => {
  const day = (word: string) => dateOf(word, TODAY);
  assert.equal(day("@heute"), "2026-11-21");
  assert.equal(day("@morgen"), "2026-11-22");
  assert.equal(day("@übermorgen"), "2026-11-23");
  assert.equal(day("@uebermorgen"), "2026-11-23");
  assert.equal(day("@MORGEN"), "2026-11-22");
  assert.equal(day("@sa"), "2026-11-21", "today counts for its own weekday");
  assert.equal(day("@samstag"), "2026-11-21");
  assert.equal(day("@sonnabend"), "2026-11-21");
  assert.equal(day("@so"), "2026-11-22");
  assert.equal(day("@mo"), "2026-11-23");
  assert.equal(day("@fr"), "2026-11-27");
  assert.equal(day("@freitag"), "2026-11-27");
});

test("date words: numeric days roll to next year once they have passed, and today has not", () => {
  const day = (word: string) => dateOf(word, TODAY);
  assert.equal(day("@23.11."), "2026-11-23");
  assert.equal(day("@23.11"), "2026-11-23");
  assert.equal(day("@3.1."), "2027-01-03");
  assert.equal(day("@21.11."), "2026-11-21");
  assert.equal(day("@20.11."), "2027-11-20");
  assert.equal(day("@1.12.2027"), "2027-12-01");
  assert.equal(day("@20.11.2020"), "2020-11-20", "a written year is taken as it is");
});

test("date words: a day that does not exist is plain text", () => {
  const day = (word: string) => dateOf(word, TODAY);
  for (const word of ["@31.02.", "@30.02.2028", "@29.02.2027", "@32.01.", "@1.13.", "@0.1.", "@1.2.26", "@12.3.20266"]) assert.equal(day(word), null, word);
  assert.equal(day("@29.02.2028"), "2028-02-29");
  assert.equal(dateOf("@29.02.", "2027-06-01"), "2028-02-29", "a leap day waits for the next leap year it can reach");
  assert.equal(dateOf("@29.02.", "2028-03-01"), null, "and none is reachable from here");
});

test("addDays steps over month and year ends", () => {
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
});

test("month words: German and English names, any case, this year unless the month has passed", () => {
  const month = (word: string) => monthOf(word, TODAY);
  for (const word of ["@dez", "@dec", "@december", "@dezember", "@DEZ", "@Dezember"]) assert.equal(month(word), "2026-12", word);
  assert.equal(month("@nov"), "2026-11", "the current month counts as this year");
  assert.equal(month("@november"), "2026-11");
  assert.equal(month("@jan"), "2027-01", "a month that has passed is next year");
  assert.equal(month("@januar"), "2027-01");
  assert.equal(month("@maerz"), "2027-03");
  assert.equal(month("@märz"), "2027-03");
  assert.equal(month("@mar"), "2027-03");
  assert.equal(month("@mai"), "2027-05");
  assert.equal(month("@okt"), "2027-10");
  assert.equal(month("@sept"), "2027-09");
});

test("month words: @mm.yyyy names the month and year, a bare @12 stays a day word or text, @mo stays Monday", () => {
  const month = (word: string) => monthOf(word, TODAY);
  assert.equal(month("@12.2026"), "2026-12");
  assert.equal(month("@1.2027"), "2027-01");
  assert.equal(month("@13.2026"), null);
  assert.equal(month("@0.2026"), null);
  assert.equal(month("@12"), null);
  assert.equal(month("@mo"), null);
  assert.equal(month("@mon"), null);
  assert.equal(month("@dez."), null);
  assert.equal(month("dez"), null);
  assert.equal(dateOf("@12", TODAY), null, "a bare @12 is no day either, it is text");
  assert.equal(dateOf("@mo", TODAY), "2026-11-23");
});

test("final: a month word is cut from the title and sets the month, not a day", () => {
  assert.deepEqual(parseMarkup("Weihnachten planen @dez", FINAL), { title: "Weihnachten planen", tags: [], date: null, month: "2026-12", time: null });
  assert.deepEqual(parseMarkup("Reise @12.2027 #urlaub", FINAL), { title: "Reise", tags: ["urlaub"], date: null, month: "2027-12", time: null });
  assert.deepEqual(parseMarkup("Reise @dec", FINAL).month, "2026-12");
});

test("final: the last day or month word wins", () => {
  assert.deepEqual(parseMarkup("x @dez @morgen", FINAL), { title: "x", tags: [], date: "2026-11-22", month: null, time: null });
  assert.deepEqual(parseMarkup("x @morgen @dez", FINAL), { title: "x", tags: [], date: null, month: "2026-12", time: null });
  assert.deepEqual(parseMarkup("x @dez @feb", FINAL).month, "2027-02");
});

test("final: @mo stays Monday and @12 stays text", () => {
  assert.equal(parseMarkup("x @mo", FINAL).date, "2026-11-23");
  assert.equal(parseMarkup("x @mo", FINAL).month, null);
  assert.deepEqual(parseMarkup("x @12", FINAL), none("x @12"));
});

const CORPUS = [
  "", " ", "plain title", "#home", "#home ", "  #home 9:00  ", "a #t", "a #t ", "  a   #t   b  ", "x #a #b 8:00 9:00",
  "Zahnarzt #health 14:30", "#work Mira anrufen", "Call 9:05 Mira", "a 14h", "a 14h ", "a 9h30", "a 5h", "a 5h ", "a 24:00 ",
  "Plan #tag, soon", "foo#bar ", "Platz #1 ", "# alone", "Müller #Übung 7h15 !", "Zeit 9:60 ", "tab\t#t\tend", "line\n#t\nend",
  `x #${"t".repeat(40)} `, `x #${"t".repeat(41)} `, "emoji #tag\u{1F600} ", "#a-b_c 10:15", "#-x- 1:5",
  "x #a #b #c", "x #Reise #work #reise #WORK #Küche ", "x #a #A #a ",
  "Zahnarzt @morgen #Arzt #health 14:30", "x @morgen @mo ", "x @mo @morgen", "@morgen", "@morgen ", "a @heute b", "a @übermorgen ",
  "a @uebermorgen ", "a @MO ", "a @sonnabend ", "a @23.11. ", "a @23.11 ", "a @3.1. ", "a @20.11. ", "a @1.12.2027 ", "a @29.02.2027 ",
  "a @29.02. ", "a @31.02. ", "a @mo. ", "mail@morgen ", "a @ ", "a @xyz ", "a @sa @so @mo ", "#a @mo 9:00", "#a @mo 9:00 ",
  "Frist 20.11. ", "x @1.2.26 ", "x @12.3.20266 ",
  "Weihnachten @dez ", "Reise @12.2027 #urlaub ", "x @dez @morgen ", "x @morgen @dez ", "x @dec @FEB ", "a @märz ", "a @maerz ", "a @mai ",
  "a @dezember", "a @12 ", "a @13.2026 ", "a @dez. ", "@dez ", "@dez",
];

test("the browser twins and the TypeScript parser agree on every line, live and final, with dates on and off", () => {
  const browser = loadBrowser();
  const cases: MarkupOptions[] = [LIVE, FINAL, { ...LIVE, dates: false }, { ...FINAL, dates: false }, { final: true, today: "2028-03-01" }];
  for (const text of CORPUS) {
    for (const options of cases) {
      const twin = JSON.parse(JSON.stringify(browser.markup.parse(text, options)));
      assert.deepEqual(twin, parseMarkup(text, options), `${JSON.stringify(text)} ${JSON.stringify(options)}`);
    }
    if (!text.includes("@")) {
      assert.deepEqual(JSON.parse(JSON.stringify(browser.markup.parse(text))), parseMarkup(text), `${JSON.stringify(text)} default`);
    }
  }
});

test("the browser date reader agrees with the TypeScript one on every word, from several days", () => {
  const browser = loadBrowser();
  const words = ["@heute", "@morgen", "@übermorgen", "@uebermorgen", "@mo", "@di", "@mi", "@do", "@fr", "@sa", "@so", "@montag", "@sonnabend",
    "@23.11.", "@3.1", "@29.02.", "@29.02.2028", "@31.02.", "@1.12.2027", "@mo.", "@", "@x", "heute", "9:00",
    "@dez", "@dec", "@december", "@dezember", "@DEZ", "@jan", "@januar", "@feb", "@märz", "@maerz", "@maer", "@mar", "@mai", "@may", "@jun",
    "@juli", "@aug", "@sept", "@oktober", "@okt", "@nov", "@12.2026", "@1.2027", "@13.2026", "@12", "@dez.", "@mon"];
  for (const today of ["2026-11-21", "2026-12-31", "2027-06-01", "2028-02-29", "2028-03-01"]) {
    for (const word of words) {
      assert.equal(browser.dateToken.of(word, today), dateOf(word, today), `${word} from ${today}`);
      assert.equal(browser.dateToken.monthOf(word, today), monthOf(word, today), `${word} month from ${today}`);
    }
  }
  assert.equal(browser.dateToken.addDays("2026-12-31", 1), addDays("2026-12-31", 1));
});
