#!/usr/bin/env node
// One-off importer for the multilingual find eval's data (cases/*.json).
//
// Inputs:
//   --cases <dir>      source eval cases, one <id>/case.json each, carrying
//                      `fixture`, `questions.en`, `questions.fr`, `expect.nodes`
//                      and (sometimes) `expect.cites`.
//   --generated <dir>  the open-weights generator's output, one <id>.json each:
//                      { questions: { es: [5], … }, terms: { en: [5], … }, generator }
//
// Copies every question and terms string verbatim and derives the expected
// file of each case deterministically:
//   - `expect.cites` when the case has it;
//   - otherwise each node of `expect.nodes` resolved to the fixture file that
//     declares it (rules below), recorded with `from: "nodes"`.
//
// Usage: node evals/multilingual/import.mjs --cases <dir> --generated <dir>

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "fixtures");
const OUT = join(HERE, "cases");
const LANGS = ["en", "fr", "es", "de", "it", "pt", "nl", "ja", "zh", "ar", "ru"];
const PER_LANG = 5;

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  if (i < 0 || !args[i + 1]) throw new Error(`missing ${name} <dir>`);
  return resolve(args[i + 1]);
};
const casesDir = flag("--cases");
const generatedDir = flag("--generated");

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

// Next.js routing conventions → the URL a file serves. App router: route groups
// "(x)" and parallel slots "@x" add no segment, "_x" folders are private (never
// routed), "[id]" is ":id", "[...x]" and "[[...x]]" are "*x". Pages router:
// pages/api/a/b.ts serves /api/a/b.
function appUrl(relDir) {
  const segs = [];
  for (const seg of relDir.split(sep).filter(Boolean)) {
    if (seg.startsWith("_")) return undefined;
    if (/^\(.*\)$/.test(seg) || seg.startsWith("@")) continue;
    const catchAll = /^\[\[?\.\.\.(.+?)\]?\]$/.exec(seg);
    const param = /^\[(.+)\]$/.exec(seg);
    segs.push(catchAll ? `*${catchAll[1]}` : param ? `:${param[1]}` : seg);
  }
  return "/" + segs.join("/");
}

function exportsMethod(source, method) {
  return (
    new RegExp(String.raw`export\s+(async\s+)?function\s+${method}\b`).test(source) ||
    new RegExp(String.raw`export\s+const\s+${method}\b`).test(source) ||
    new RegExp(String.raw`export\s*\{[^}]*\b${method}\b[^}]*\}`).test(source)
  );
}

// Every file of `fixture` that declares `node`. Must be exactly one.
function declaring(fixture, node) {
  const root = join(FIXTURES, fixture);
  const files = walk(root).map((p) => relative(root, p));
  const read = (rel) => readFileSync(join(root, rel), "utf8");
  const [kind, ...rest] = node.split(":");
  const id = rest.join(":");
  let hits = [];
  if (kind === "screen") {
    hits = files.filter((rel) => {
      const m = /^(?:src\/)?app\/(.*?)\/?page\.[jt]sx?$/.exec(rel.split(sep).join("/"));
      return m && appUrl(m[1]) === id;
    });
  } else if (kind === "route") {
    const [method, path] = id.split(" ");
    hits = files.filter((rel) => {
      const posix = rel.split(sep).join("/");
      const app = /^(?:src\/)?app\/(.*?)\/?route\.[jt]s$/.exec(posix);
      if (app) return appUrl(app[1]) === path && exportsMethod(read(rel), method);
      const pages = /^(?:src\/)?pages(\/api\/.*?)(?:\/index)?\.[jt]s$/.exec(posix);
      return pages ? pages[1] === path : false; // a pages/api handler serves every method
    });
  } else if (kind === "sym") {
    const file = id.split("#")[0];
    hits = files.includes(file) ? [file] : [];
  } else if (kind === "entity") {
    hits = files.filter((rel) => rel.endsWith(".prisma") && new RegExp(String.raw`^model\s+${id}\s*\{`, "m").test(read(rel)));
  } else {
    throw new Error(`no derivation rule for node "${node}"`);
  }
  if (hits.length !== 1) throw new Error(`${fixture}: node "${node}" resolves to ${hits.length} files (${hits.join(", ")})`);
  return hits[0].split(sep).join("/");
}

mkdirSync(OUT, { recursive: true });
let written = 0;
for (const id of readdirSync(casesDir).sort()) {
  const casePath = join(casesDir, id, "case.json");
  if (!existsSync(casePath)) continue;
  const src = JSON.parse(readFileSync(casePath, "utf8"));
  if (!src.questions?.en?.length) continue; // flow/model cases carry no questions
  const gen = JSON.parse(readFileSync(join(generatedDir, `${id}.json`), "utf8"));
  if (gen.generator !== "glm-5.3-flash") throw new Error(`${id}: unexpected generator "${gen.generator}"`);
  if (!existsSync(join(FIXTURES, src.fixture))) throw new Error(`${id}: fixture "${src.fixture}" not copied`);

  const nodes = src.expect?.nodes ?? [];
  const cites = src.expect?.cites;
  const files = cites?.length ? cites : [...new Set(nodes.map((n) => declaring(src.fixture, n)))];
  for (const f of files) if (!existsSync(join(FIXTURES, src.fixture, f))) throw new Error(`${id}: ${f} missing from ${src.fixture}`);

  const questions = { en: src.questions.en, fr: src.questions.fr };
  for (const lang of LANGS.slice(2)) questions[lang] = gen.questions[lang];
  const terms = {};
  for (const lang of LANGS) terms[lang] = gen.terms[lang];
  for (const lang of LANGS) {
    if (questions[lang]?.length !== PER_LANG) throw new Error(`${id}: ${PER_LANG} ${lang} questions expected`);
    if (terms[lang]?.length !== PER_LANG) throw new Error(`${id}: ${PER_LANG} ${lang} terms expected`);
  }

  const data = {
    id,
    fixture: src.fixture,
    expect: { files, from: cites?.length ? "cites" : "nodes", nodes },
    questions,
    terms,
    generator: "glm-5.3-flash",
    provenance:
      "questions.en and questions.fr: the source eval cases, verbatim. Every other question (paraphrases of those) and every terms string: generated by glm-5.3-flash (open weights, MIT), verbatim.",
  };
  writeFileSync(join(OUT, `${id}.json`), JSON.stringify(data, null, 2) + "\n");
  written++;
  console.log(`${id}: ${files.join(", ")} (from ${data.expect.from})`);
}
console.log(`wrote ${written} case(s) to ${relative(process.cwd(), OUT) || OUT}`);
