import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { dateOf } from "../src/log/date-token.ts";

type Item = { tag: string; count: number; lastUsed: number };
type Option = { kind: string; label: string; hint: string; insert: string; value: string };
type Token = { kind: "tag" | "date"; query: string; start: number; end: number };

type Suggest = {
  fuzzy: { fold: (text: string) => string; rank: (query: string, pool: Item[], limit?: number) => Item[] };
  dates: {
    suggest: (query: string, today: string) => Array<{ iso: string; label: string; hint: string; insert: string }>;
    suggestMonths: (query: string, today: string) => Array<{ month: string; label: string; hint: string; insert: string }>;
  };
  token: { at: (text: string, caret: number) => Token | null; apply: (text: string, token: Token, insert: string) => { text: string; caret: number } };
  options: { optionsFor: (token: { kind: string; query: string }, line: { tags: string[] }, pool: Item[], today: string) => Option[] };
};

/** The browser modules, loaded the way a page loads them: scripts that hang themselves on one window.BujoLog. */
function load(): Suggest {
  const window: { BujoLog?: { suggest: Suggest } } = {};
  const files = ["copy.js", "date-token.js", "tags.js", "suggest/fuzzy.js", "suggest/dates.js", "suggest/token.js", "suggest/options.js"];
  for (const file of files) vm.runInNewContext(readFileSync(new URL(`../public/js/log/${file}`, import.meta.url), "utf8"), { window });
  return window.BujoLog!.suggest;
}

/** Results come out of another realm, so compare them as JSON. */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const S = load();
/** A Saturday. */
const TODAY = "2026-11-21";
const use = (tag: string, count = 1, lastUsed = 0): Item => ({ tag, count, lastUsed });
const tagsOf = (items: Item[]) => plain(items.map((item) => item.tag));

// ----- fuzzy -----

test("fuzzy: umlauts, eszett and ae/oe/ue spellings fold to one word", () => {
  const fold = S.fuzzy.fold;
  assert.equal(fold("Küche"), fold("kueche"));
  assert.equal(fold("Küche"), fold("kuche"));
  assert.equal(fold("Käse"), fold("kaese"));
  assert.equal(fold("Straße"), fold("STRASSE"));
  assert.equal(fold("Café"), "cafe");
});

test("fuzzy: the better match comes first, whatever the recency", () => {
  const pool = [use("xhealth", 9, 900), use("health", 1, 100), use("self-health", 1, 500), use("healthy", 1, 200)];
  assert.deepEqual(tagsOf(S.fuzzy.rank("health", pool)), ["health", "healthy", "self-health", "xhealth"]);
});

test("fuzzy: among equal matches the newest use comes first, then the more used, then the name", () => {
  const pool = [use("work-b", 1, 100), use("work-a", 1, 300), use("work-c", 5, 100), use("work-d", 1, 100)];
  assert.deepEqual(tagsOf(S.fuzzy.rank("work", pool)), ["work-a", "work-c", "work-b", "work-d"]);
});

test("fuzzy: an umlaut tag is found by either spelling", () => {
  const pool = [use("Küche"), use("Käse"), use("work")];
  for (const query of ["kuche", "kueche", "KÜ"]) assert.deepEqual(tagsOf(S.fuzzy.rank(query, pool)), ["Küche"], query);
  assert.deepEqual(tagsOf(S.fuzzy.rank("kaese", pool)), ["Käse"]);
});

test("fuzzy: letters in order match from two letters on, one stray letter does not", () => {
  const pool = [use("haushalt"), use("health")];
  assert.deepEqual(tagsOf(S.fuzzy.rank("hsh", pool)), ["haushalt"]);
  assert.deepEqual(tagsOf(S.fuzzy.rank("hlt", pool)), ["haushalt", "health"]);
  assert.deepEqual(tagsOf(S.fuzzy.rank("z", pool)), []);
});

test("fuzzy: an empty query keeps every tag by recency, and the limit cuts the list", () => {
  const pool = [use("a", 1, 1), use("b", 1, 3), use("c", 1, 2)];
  assert.deepEqual(tagsOf(S.fuzzy.rank("", pool)), ["b", "c", "a"]);
  assert.deepEqual(tagsOf(S.fuzzy.rank("  ", pool, 2)), ["b", "c"]);
  assert.deepEqual(plain(S.fuzzy.rank("", [])), []);
});

// ----- dates -----

test("dates: no query lists today and the days after it, with a hint for the words", () => {
  const list = plain(S.dates.suggest("", TODAY));
  assert.equal(list.length, 6);
  assert.deepEqual(list.slice(0, 3).map((item) => [item.label, item.hint, item.insert]), [
    ["Sa 21.11.", "heute", "@21.11."],
    ["So 22.11.", "morgen", "@22.11."],
    ["Mo 23.11.", "übermorgen", "@23.11."],
  ]);
});

test("dates: a short weekday lists that weekday before the words that only start the same", () => {
  const list = plain(S.dates.suggest("mo", TODAY));
  assert.deepEqual(list.map((item) => item.iso), ["2026-11-23", "2026-11-22"]);
  assert.equal(list[0].label, "Mo 23.11.");
  assert.equal(list[1].hint, "morgen");
});

test("dates: a word prefix, folded, finds umlaut words", () => {
  assert.deepEqual(plain(S.dates.suggest("uber", TODAY)).map((item) => item.iso), ["2026-11-23"]);
  assert.deepEqual(plain(S.dates.suggest("frei", TODAY)).map((item) => item.iso), ["2026-11-27"]);
  assert.deepEqual(plain(S.dates.suggest("zzz", TODAY)), []);
});

test("dates: a bare day of the month is this month while ahead, else next month, and skips months without it", () => {
  const day = (query: string, today = TODAY) => plain(S.dates.suggest(query, today)).map((item) => item.iso);
  assert.deepEqual(day("23"), ["2026-11-23"]);
  assert.deepEqual(day("21"), ["2026-11-21"], "today is still ahead");
  assert.deepEqual(day("5"), ["2026-12-05"]);
  assert.deepEqual(day("31"), ["2026-12-31"]);
  assert.deepEqual(day("31", "2026-12-31"), ["2026-12-31"]);
  assert.deepEqual(day("31", "2026-01-31"), ["2026-01-31"]);
  assert.deepEqual(day("31", "2026-02-01"), ["2026-03-31"], "february has no 31st");
  assert.deepEqual(day("30", "2027-01-31"), ["2027-03-30"]);
});

test("dates: day and month give this year, or next year with the year written once it has passed", () => {
  const day = (query: string) => plain(S.dates.suggest(query, TODAY))[0];
  assert.equal(day("23.11").insert, "@23.11.");
  assert.equal(day("3.12.").insert, "@03.12.");
  assert.equal(day("1.1.").insert, "@01.01.2027");
  assert.equal(day("1.1.").label, "Fr 01.01.2027");
  assert.equal(day("1.12.2027").insert, "@01.12.2027");
  assert.deepEqual(plain(S.dates.suggest("31.02.", TODAY)), []);
});

test("dates: every insert is read back by the parser as the day the suggestion names", () => {
  for (const today of [TODAY, "2026-12-30", "2028-02-28"]) {
    for (const query of ["", "m", "mo", "d", "f", "s", "uber", "23", "1", "29", "1.1", "29.2"]) {
      for (const item of plain(S.dates.suggest(query, today))) assert.equal(dateOf(item.insert, today), item.iso, `${item.insert} from ${today}`);
    }
  }
});

// ----- token -----

test("token: a # or @ word that ends at the caret is found, with the text after the mark as the query", () => {
  assert.deepEqual(plain(S.token.at("Zahnarzt #hea", 13)), { kind: "tag", query: "hea", start: 9, end: 13 });
  assert.deepEqual(plain(S.token.at("#", 1)), { kind: "tag", query: "", start: 0, end: 1 });
  assert.deepEqual(plain(S.token.at("x @mo", 5)), { kind: "date", query: "mo", start: 2, end: 5 });
  assert.deepEqual(plain(S.token.at("x @23.1", 7)), { kind: "date", query: "23.1", start: 2, end: 7 });
  assert.deepEqual(plain(S.token.at("x #Küche_2-a", 12)), { kind: "tag", query: "Küche_2-a", start: 2, end: 12 });
});

test("token: the caret before a space still ends the word, in the middle of a word it does not", () => {
  assert.equal(S.token.at("a #ab c", 5)?.query, "ab");
  assert.equal(S.token.at("a #abc", 4), null);
  assert.equal(S.token.at("a #ab c", 7), null, "after plain text");
  assert.equal(S.token.at("a #ab ", 6), null, "after a space");
});

test("token: glued or odd words are not tokens", () => {
  for (const text of ["foo#bar", "mail@morgen", "plain", "", "#a,b", "#tag!", "#a#b", "@mo,"]) assert.equal(S.token.at(text, text.length), null, text);
  assert.equal(S.token.at("#a", 0), null);
  assert.equal(S.token.at("#a", 9), null);
});

test("token: a tab or a line break also starts a word", () => {
  assert.equal(S.token.at("a\t#ab", 5)?.query, "ab");
  assert.equal(S.token.at("a\n@mo", 5)?.kind, "date");
});

test("token: apply swaps the word for the pick and one space, and puts the caret after it", () => {
  const text = "Zahnarzt #hea";
  const token = S.token.at(text, text.length)!;
  assert.deepEqual(plain(S.token.apply(text, token, "#health")), { text: "Zahnarzt #health ", caret: 17 });
});

test("token: apply in the middle of a line reuses the space that follows instead of doubling it", () => {
  const text = "a #he b";
  const token = S.token.at(text, 5)!;
  assert.deepEqual(plain(S.token.apply(text, token, "#health")), { text: "a #health b", caret: 10 });
  const lone = S.token.at("a #he\tb", 5)!;
  assert.deepEqual(plain(S.token.apply("a #he\tb", lone, "#x")), { text: "a #x b", caret: 5 }, "a tab after the word is swapped for one space");
});

// ----- options -----

const POOL = [use("health", 3, 300), use("Haushalt", 5, 200), use("Küche", 1, 100)];
const optionsFor = (kind: "tag" | "date", query: string, tags: string[] = [], pool = POOL) => plain(S.options.optionsFor({ kind, query }, { tags }, pool, TODAY));

test("options: tags come best first with their own spelling, and a new word is offered last", () => {
  const list = optionsFor("tag", "ha");
  assert.deepEqual(list.map((o) => [o.kind, o.insert, o.value]), [
    ["tag", "#Haushalt", "Haushalt"],
    ["tag", "#health", "health"],
    ["new", "#ha", "ha"],
  ]);
  assert.equal(list[0].label, "#Haushalt");
  assert.match(list[2].label, /#ha/);
});

test("options: an exact existing tag is not offered again as a new one", () => {
  const list = optionsFor("tag", "HEALTH");
  assert.deepEqual(list.map((o) => [o.kind, o.insert]), [["tag", "#health"]]);
});

test("options: tags the line has already are left out, in any case", () => {
  assert.deepEqual(optionsFor("tag", "ha", ["HEALTH"]).filter((o) => o.kind === "tag").map((o) => o.value), ["Haushalt"]);
  assert.equal(optionsFor("tag", "health", ["health"]).length, 0, "and it is not offered as new either");
});

test("options: a bare # lists the pool by recency and offers nothing new", () => {
  assert.deepEqual(optionsFor("tag", "").map((o) => o.value), ["health", "Haushalt", "Küche"]);
});

test("options: a query that cannot be a tag is not offered as one", () => {
  assert.deepEqual(optionsFor("tag", "123"), []);
  assert.deepEqual(optionsFor("tag", "t".repeat(41)).filter((o) => o.kind === "new"), []);
  assert.equal(optionsFor("tag", "kueche")[0].insert, "#Küche");
});

test("options: the list is at most six long and the new word still gets its place", () => {
  const pool = Array.from({ length: 9 }, (_, i) => use(`tag${i}`, 1, i));
  const list = optionsFor("tag", "tag", [], pool);
  assert.equal(list.length, 6);
  assert.deepEqual(list.map((o) => o.kind), ["tag", "tag", "tag", "tag", "tag", "new"]);
  assert.equal(optionsFor("tag", "", [], pool).length, 6);
});

test("options: a date token gives dates shaped like the tag options", () => {
  const list = optionsFor("date", "mo");
  assert.deepEqual(list.map((o) => [o.kind, o.label, o.hint, o.insert, o.value]), [
    ["date", "Mo 23.11.", "Montag", "@23.11.", "2026-11-23"],
    ["date", "So 22.11.", "morgen", "@22.11.", "2026-11-22"],
  ]);
});

test("months: de, dez and dec all offer December, as a whole month, with no year this year", () => {
  for (const query of ["de", "dez", "dec", "DEZ", "december"]) {
    const list = optionsFor("date", query).filter((o) => o.kind === "month");
    assert.deepEqual(list.map((o) => [o.label, o.hint, o.insert, o.value]), [["December", "whole month", "@dezember", "2026-12"]], query);
  }
});

test("months: a month that has passed this year is offered for next year, with the year", () => {
  const list = optionsFor("date", "jan").filter((o) => o.kind === "month");
  assert.deepEqual(list.map((o) => [o.label, o.insert, o.value]), [["January 2027", "@01.2027", "2027-01"]]);
});

test("months: the current month counts as this year", () => {
  const list = optionsFor("date", "nov").filter((o) => o.kind === "month");
  assert.deepEqual(list.map((o) => [o.label, o.insert, o.value]), [["November", "@november", "2026-11"]]);
});

test("months: a written mm.yyyy is offered as that month, and a bare number or a one letter query is not", () => {
  assert.deepEqual(plain(S.dates.suggestMonths("12.2027", TODAY)).map((o) => o.month), ["2027-12"]);
  assert.deepEqual(plain(S.dates.suggestMonths("12", TODAY)), []);
  assert.deepEqual(plain(S.dates.suggestMonths("", TODAY)), []);
});

test("months: @mo still offers Monday first and no month, and the days come before the months", () => {
  const list = optionsFor("date", "mo");
  assert.equal(list[0].value, "2026-11-23");
  assert.equal(list.some((o) => o.kind === "month"), false);
  const mixed = optionsFor("date", "di");
  assert.equal(mixed[0].kind, "date");
});
