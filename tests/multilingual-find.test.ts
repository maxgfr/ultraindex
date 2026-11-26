import { describe, it, expect } from "vitest";
import { SCHEMA_VERSION, VERSION } from "../src/types.js";
import type { Graph, FileNode, ModuleNode } from "../src/types.js";
import { findModules, pickSeeds, scoreModules } from "../src/find.js";
import { buildHaystack, queryTerms, scoreHaystack, splitIdentifier, QUESTION_WEIGHT_WITH_TERMS } from "../src/lex.js";
import { keywords } from "../src/engine.js";
import { parseArgs } from "../src/cli.js";
import { TOOLS } from "../src/mcp/tools.js";

// Questions in any language: the haystack keeps every script the engine's
// keywords() keeps (CJK as bigrams), and `--terms` bridges a question written
// in a language the code does not share.

const hit = (text: string, q: string): number => scoreHaystack(buildHaystack(text), queryTerms(q)).score;

describe("Unicode haystack", () => {
  it("keeps non-Latin words instead of dropping them", () => {
    expect(hit("обработка платежей для заказа", "платежей")).toBeGreaterThan(0);
    expect(hit("معالجة الطلبات والدفع", "الطلبات")).toBeGreaterThan(0);
    expect(hit("Λογαριασμός χρήστη", "χρήστη")).toBeGreaterThan(0);
  });

  it("matches CJK through the engine's bigrams, the same way the query is cut", () => {
    // keywords() cuts a CJK question into overlapping bigrams…
    expect(keywords("注文を取り消す")).toEqual(["注文", "文を", "を取", "取り", "り消", "消す"]);
    // …and the haystack is cut the same way, so a phrase hits as a token, not
    // only through the substring fallback.
    const hay = buildHaystack("注文の取り消しを処理するサービス");
    expect(hay.counts.get("注文")).toBe(1);
    expect(hay.counts.get("取り")).toBe(1);
    const r = scoreHaystack(hay, queryTerms("注文 取り消し"));
    expect(r.matched).toContain("注文");
    expect(r.score).toBeGreaterThan(0);
  });

  it("agrees with the engine on composed and decomposed forms (kana, Hangul)", () => {
    expect(hit("データベースの設定", "データ")).toBeGreaterThan(0);
    expect(hit("사용자 로그인 처리", "로그인")).toBeGreaterThan(0);
  });

  it("splits Unicode identifiers on case humps and keeps unsplittable words whole", () => {
    expect(splitIdentifier("BenutzerProfil")).toEqual(["benutzer", "profil"]);
    expect(splitIdentifier("größe")).toEqual(["große"]);
    expect(splitIdentifier("créerCommande")).toEqual(["creer", "commande"]);
    expect(splitIdentifier("用户登录")).toEqual(["用户", "户登", "登录"]);
    // ASCII stays on the historical splitter.
    expect(splitIdentifier("OAuth2Token")).toEqual(["o", "auth", "2", "token"]);
  });

  it("tokenizes the ASCII words of mixed text exactly as pure ASCII text", () => {
    const ascii = buildHaystack("retry backoff - payment queue");
    const mixed = buildHaystack("retry backoff — payment queue");
    expect([...mixed.counts.entries()].sort()).toEqual([...ascii.counts.entries()].sort());
    expect(mixed.length).toBe(ascii.length);
  });

  it("finds a repo documented in the question's language without --terms", () => {
    const g = graph([
      ["billing", "src/billing", "Обработка платежей и счетов"],
      ["catalog", "src/catalog", "Каталог товаров"],
    ]);
    expect(findModules(g, "где обработка платежей?", 5)[0]?.slug).toBe("billing");
  });
});

describe("queryTerms with --terms", () => {
  it("merges terms with the question: terms first, deduped by stem, counted once", () => {
    const terms = queryTerms("where are orders canceled", "order cancel refund");
    expect(terms.map((t) => t.raw)).toEqual(["order", "cancel", "refund"]);
    // "orders"/"canceled" are the same terms as "order"/"cancel": one entry, full weight.
    expect(terms.every((t) => t.weight === 1)).toBe(true);
  });

  it("down-weights the question's own words and drops their substring tier", () => {
    const terms = queryTerms("¿Dónde se cancela un pedido?", "order cancel");
    const pedido = terms.find((t) => t.raw === "pedido")!;
    expect(pedido.weight).toBe(QUESTION_WEIGHT_WITH_TERMS);
    expect(pedido.substring).toBe(false);
    expect(terms.find((t) => t.raw === "order")!.weight).toBe(1);
  });

  it("keeps an identifier-shaped question word at full weight", () => {
    const terms = queryTerms("¿Qué hace cancelOrder?", "order cancel");
    expect(terms.find((t) => t.raw === "cancelOrder")!.weight).toBe(1);
  });

  it("is the plain question when terms are absent or empty", () => {
    expect(queryTerms("cancel the order", "  ")).toEqual(queryTerms("cancel the order"));
    expect(queryTerms("cancel the order").every((t) => t.weight === 1 && t.substring)).toBe(true);
  });
});

function fileNode(rel: string, module: string): FileNode {
  return {
    id: rel, kind: "file", rel, fileKind: "code", lang: "typescript", module,
    title: rel.split("/").pop()!, symbols: 1, lines: 10, degIn: 0, degOut: 0,
  };
}

function graph(mods: [slug: string, path: string, summary: string][]): Graph {
  const files: FileNode[] = [];
  const modules: ModuleNode[] = [];
  for (const [slug, path, summary] of mods) {
    const rel = `${path}/index.ts`;
    files.push(fileNode(rel, slug));
    modules.push({
      id: slug, kind: "module", slug, path, title: path, summary, tier: 1, members: [rel],
      symbols: 1, degIn: 0, degOut: 0,
    });
  }
  return {
    schemaVersion: SCHEMA_VERSION, version: VERSION, fileCount: files.length,
    languages: { typescript: files.length }, files, modules, fileEdges: [], moduleEdges: [],
  };
}

describe("findModules with --terms", () => {
  // "delivery-label" collides with the Spanish function words "de" and "la" by
  // substring; the target shares no word with the question at all.
  const shop = (): Graph =>
    graph([
      ["orders", "src/orders", "Cancel an order and refund the payment"],
      ["delivery-label", "src/delivery/label", "Print the delivery label of a parcel"],
      ["catalog", "src/catalog", "Product catalog listing"],
    ]);
  const question = "¿Cómo se cancela un pedido de la tienda?";

  it("bridges a question that shares no word with the code", () => {
    // Alone, the question only collides by substring ("de", "la", "un"), and
    // the noise wins.
    expect(findModules(shop(), question, 5)[0]?.slug).toBe("delivery-label");
    const top = findModules(shop(), question, 5, undefined, undefined, "order cancel refund")[0];
    expect(top?.slug).toBe("orders");
    expect(top?.matched).toEqual(["cancel", "order", "refund"]);
  });

  it("does not let the question's untranslatable words dominate the ranking", () => {
    const rows = findModules(shop(), question, 5, undefined, undefined, "order cancel refund");
    // Function words of the question no longer substring-match the label module.
    expect(rows.map((r) => r.slug)).not.toContain("delivery-label");
  });

  it("gives the same ranking whatever language the question is in", () => {
    const terms = "order cancel refund";
    const slugsFor = (q: string): string[] => findModules(shop(), q, 5, undefined, undefined, terms).map((r) => r.slug);
    const reference = slugsFor("How do I cancel an order?");
    for (const q of ["Comment annuler une commande ?", "注文をキャンセルするには？", "Как отменить заказ?", "كيف ألغي الطلب؟"]) {
      expect(slugsFor(q), q).toEqual(reference);
    }
  });

  it("never seeds graph expansion from a down-weighted question word", () => {
    const g = shop();
    const terms = queryTerms("pedido delivery", "order cancel");
    // "delivery" is an English word in the question: it still ranks, at half weight…
    const full = scoreModules(g, "pedido delivery", undefined, undefined, "order cancel");
    expect(full.map((x) => x.r.slug)).toContain("delivery-label");
    // …but the per-term guarantee only covers the full-weight terms.
    expect(pickSeeds(full, terms.filter((t) => t.weight < 1))).toEqual([full[0]!.r.slug]);
  });
});

describe("--terms surfaces", () => {
  it("parses --terms on find and ask", () => {
    const f = parseArgs(["find", "¿dónde", "se", "cancela?", "--terms", "order cancel"]);
    expect(f.values.terms).toBe("order cancel");
    expect(f.positional).toEqual(["¿dónde", "se", "cancela?"]);
    expect(parseArgs(["ask", "q", "--terms=order"]).values.terms).toBe("order");
  });

  it("declares a terms string on the MCP find and ask tools", () => {
    for (const name of ["ultraindex_find", "ultraindex_ask"]) {
      const tool = TOOLS.find((t) => t.name === name)!;
      expect(tool.inputSchema.properties.terms?.type, name).toBe("string");
      expect(tool.inputSchema.required, name).not.toContain("terms");
    }
  });
});
