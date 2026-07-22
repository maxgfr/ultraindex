import { describe, it, expect } from "vitest";
import { splitIdentifier, stem, synonymGroup, queryTerms, buildHaystack, scoreHaystack } from "../src/lex.js";
import { foldText, keywords } from "../src/engine.js";

describe("foldText (NFKD diacritic folding)", () => {
  it("strips diacritics but leaves plain ASCII untouched", () => {
    expect(foldText("café")).toBe("cafe");
    expect(foldText("naïve résumé")).toBe("naive resume");
    expect(foldText("getUserProfile")).toBe("getUserProfile");
  });

  it("folds both query and haystack so accented and plain forms agree", () => {
    // Query accented, haystack plain — and the reverse — must both match.
    expect(scoreHaystack(buildHaystack("cafe module"), queryTerms("café")).score).toBeGreaterThan(0);
    expect(scoreHaystack(buildHaystack("café module"), queryTerms("cafe")).score).toBeGreaterThan(0);
    // A folded term tokenizes whole ("cafe"), not truncated at the accent ("caf").
    expect(keywords("café")).toEqual(["cafe"]);
  });

  it("does not alter plain-ASCII tokenization", () => {
    expect(keywords("parse HTTP config")).toEqual(["parse", "HTTP", "config"]);
  });
});

describe("splitIdentifier", () => {
  it("splits camelCase and PascalCase", () => {
    expect(splitIdentifier("getUserProfile")).toEqual(["get", "user", "profile"]);
    expect(splitIdentifier("ParseConfig")).toEqual(["parse", "config"]);
  });

  it("splits acronym boundaries", () => {
    expect(splitIdentifier("HTTPServer")).toEqual(["http", "server"]);
  });

  it("splits snake_case and kebab-case", () => {
    expect(splitIdentifier("user_profile")).toEqual(["user", "profile"]);
    expect(splitIdentifier("user-profile")).toEqual(["user", "profile"]);
  });

  it("splits letter/digit boundaries and dedupes", () => {
    expect(splitIdentifier("OAuth2Token")).toEqual(["o", "auth", "2", "token"]);
    expect(splitIdentifier("fooFoo")).toEqual(["foo"]);
  });

  it("is deterministic", () => {
    expect(splitIdentifier("getUserProfile")).toEqual(splitIdentifier("getUserProfile"));
  });
});

describe("stem", () => {
  it("strips plurals", () => {
    expect(stem("sessions")).toBe("session");
    expect(stem("queries")).toBe("query");
    expect(stem("classes")).toBe("class");
  });

  it("strips -ing and -ed, folding the trailing -e variant", () => {
    expect(stem("parsing")).toBe(stem("parses"));
    expect(stem("parsing")).toBe(stem("parse"));
    expect(stem("rendered")).toBe(stem("render"));
  });

  it("leaves short tokens, -ss words and digit-bearing tokens alone", () => {
    expect(stem("css")).toBe("css");
    expect(stem("class")).toBe("class");
    expect(stem("429s")).toBe("429s");
    expect(stem("db")).toBe("db");
  });
});

describe("synonymGroup", () => {
  it("groups code-domain synonyms together", () => {
    expect(synonymGroup("auth")).toBeDefined();
    expect(synonymGroup("auth")).toBe(synonymGroup("authentication"));
    expect(synonymGroup("auth")).toBe(synonymGroup("login"));
    expect(synonymGroup("db")).toBe(synonymGroup("database"));
  });

  it("keeps unrelated words apart", () => {
    expect(synonymGroup("auth")).not.toBe(synonymGroup("database"));
    expect(synonymGroup("zebra")).toBeUndefined();
  });
});

describe("queryTerms", () => {
  it("drops stopwords and dedupes, keeping raw forms", () => {
    const terms = queryTerms("how does the auth auth work");
    expect(terms.map((t) => t.raw)).toEqual(["auth"]);
  });

  it("expands identifiers into meaningful subtokens (no stopword humps)", () => {
    const t = queryTerms("getUserProfile")[0]!;
    expect(t.forms).toContain("user");
    expect(t.forms).toContain("profile");
    expect(t.forms).not.toContain("get"); // stopword hump carries no signal
  });
});

describe("scoreHaystack", () => {
  const terms = (q: string) => queryTerms(q);

  it("scores exact > stem/subtoken > synonym > substring", () => {
    const exact = scoreHaystack(buildHaystack("auth middleware"), terms("auth"));
    const syn = scoreHaystack(buildHaystack("login middleware"), terms("auth"));
    const sub = scoreHaystack(buildHaystack("preauthx middleware"), terms("auth"));
    expect(exact.score).toBe(3);
    expect(syn.score).toBe(1.5);
    expect(sub.score).toBe(1);
    expect(exact.matched).toEqual(["auth"]);
  });

  it("matches identifier queries against split paths", () => {
    const r = scoreHaystack(buildHaystack("src/user/profile.ts"), terms("getUserProfile"));
    expect(r.score).toBeGreaterThanOrEqual(2);
    expect(r.matched).toEqual(["getUserProfile"]);
  });

  it("matches stems across plural/-ing variants", () => {
    const r = scoreHaystack(buildHaystack("parses incoming requests"), terms("parsing"));
    expect(r.matched).toContain("parsing");
    expect(r.score).toBeGreaterThanOrEqual(2);
  });

  it("matches synonyms via the haystack's identifier subtokens", () => {
    const r = scoreHaystack(buildHaystack("authentication middleware"), terms("auth"));
    expect(r.score).toBe(1.5);
  });

  it("normalizes long saturated haystacks so repetition can't dominate", () => {
    const short = scoreHaystack(buildHaystack("billing invoices"), terms("billing"), true);
    const padding = Array.from({ length: 600 }, (_, i) => `word${i}`).join(" ");
    const long = scoreHaystack(buildHaystack(`billing ${padding}`), terms("billing"), true);
    expect(long.score).toBeLessThan(short.score);
  });

  it("caps the saturation bonus", () => {
    const once = scoreHaystack(buildHaystack("billing"), terms("billing"), true);
    const many = scoreHaystack(buildHaystack(Array(50).fill("billing").join(" ")), terms("billing"), true);
    expect(many.score).toBeLessThanOrEqual(once.score * 1.5);
  });

  it("is deterministic", () => {
    const a = scoreHaystack(buildHaystack("auth login session"), terms("authentication session"));
    const b = scoreHaystack(buildHaystack("auth login session"), terms("authentication session"));
    expect(a).toEqual(b);
  });
});
