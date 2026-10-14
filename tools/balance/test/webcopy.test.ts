import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { ICON_D } from "../../../apps/web/src/icons/paths";
import { describe, expect, it } from "vitest";
import { CATEGORY_TEXT, RESULT_REASON_TEXT, describeRound, explainResult, runBotMatch } from "@sysd/match";

/** The same rule as everywhere else: nothing a player reads may contain an abbreviation. */
const BANNED_UPPER = /\b(LB|CDN|DB|API|RPS|QPS|SLO|SLA|TTL|HP|PP|UI|UX|OK|CPU|RAM|SQL|HTTP|URL|IO)\b/;
const BANNED_LOWER = /\b(app|apps|lb|cdn|db|rps|qps|ms|sec|secs|vs|etc|info|config|repl|avg|min|kb|mb|gb|p99|p50|p95|ttl|slo|api)\b/i;
const BANNED_LATIN = /\b(e\.g\.|i\.e\.|etc\.|vs\.)/i;
const plain = (text: string, where: string): void => {
  expect(text, `${where}: "${text}"`).not.toMatch(BANNED_UPPER);
  expect(text, `${where}: "${text}"`).not.toMatch(BANNED_LOWER);
  expect(text, `${where}: "${text}"`).not.toMatch(BANNED_LATIN);
};

const ROOT = join(__dirname, "../../../apps/web/src");
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : p.endsWith(".tsx") ? [p] : []; });

/** Attributes whose value a player can read or hear. Everything else (className, style, key, id...) is code. */
const VISIBLE_ATTRS = new Set(["title", "aria-label", "placeholder", "alt", "hint", "tag", "label", "leftTitle", "rightTitle", "meta", "body", "note", "text", "who", "crumbs"]);

/** A string that is exactly an icon id or a colour is code, not something a player reads. A sentence that merely contains one is still checked. */
const isCode = (t: string): boolean => t in ICON_D || /^(var\(--|#[0-9a-f]{3,8}$)/i.test(t);

function visibleText(path: string): string[] {
  const src = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: string[] = [];
  const strings = (n: ts.Node): void => {
    if (ts.isJsxAttribute(n)) return;                      // class names, ids and styles nested in JSX are code, not copy
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) { if (!isCode(n.text)) out.push(n.text); }
    else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) out.push(n.text);
    ts.forEachChild(n, strings);
  };
  const walk = (n: ts.Node): void => {
    if (ts.isJsxText(n)) { const t = n.text.replace(/\s+/g, " ").trim(); if (t) out.push(t); }
    else if (ts.isJsxExpression(n) && n.parent && !ts.isJsxAttribute(n.parent) && n.expression) strings(n.expression);
    else if (ts.isJsxAttribute(n) && VISIBLE_ATTRS.has(n.name.getText())) { if (n.initializer) strings(n.initializer); return; }
    else if (ts.isJsxAttribute(n)) {
      // a prop that carries JSX (pills={<>...</>}, status={...}) still holds visible text: look inside it
      if (n.initializer && ts.isJsxExpression(n.initializer) && n.initializer.expression) ts.forEachChild(n.initializer, walk);
      return;
    }
    else if (ts.isCallExpression(n)) {
      const callee = n.expression.getText();
      if (/(^|\.)(say|confirm|alert)$/.test(callee)) n.arguments.forEach(strings);
    }
    ts.forEachChild(n, walk);
  };
  walk(src);
  return out;
}

describe("everything a player reads in the browser app is plain language", () => {
  const all = files(ROOT);
  it("finds the screens (so this test cannot silently scan nothing)", () => {
    expect(all.length).toBeGreaterThan(14);
    expect(all.some((f) => f.endsWith("Siege.tsx"))).toBe(true);
  });

  for (const f of all) {
    it(f.slice(ROOT.length + 1), () => { for (const t of visibleText(f)) plain(t, f.slice(ROOT.length + 1)); });
  }

  it("the extractor really reaches text in every place copy can hide (proved on real screens)", () => {
    const home = visibleText(join(ROOT, "screens/Home.tsx")).join("\n");
    expect(home).toContain("Start a run");                       // plain JSX text
    expect(home).toContain("every spike.");             // text inside an element nested in a heading
    expect(home).toContain("Open source.");                              // a sentence inside a paragraph
    expect(home).not.toContain("cell off");                           // class names are code, not copy
    expect(home).not.toMatch(/(^|\n)LB(\n|$)/);                           // an icon id on its own is code
    const site = visibleText(join(ROOT, "shell/Site.tsx")).join("\n");
    expect(site).toContain("Choose a name");
    expect(site).toContain("sysd-2d");
    const siege = visibleText(join(ROOT, "screens/match/Siege.tsx")).join("\n");
    expect(siege).toContain("Lock in");
    expect(siege).toContain("Hold back");
  });

  it("and it catches an abbreviation planted in a prop, an attribute, nested JSX and a message", async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "copy-"));
    const plant = (name: string, code: string): string[] => { const f = join(dir, name); writeFileSync(f, code); return visibleText(f); };
    expect(plant("a.tsx", `export const A = () => <Frame pills={<><span className="pill">Fast CDN</span></>} />;`).join()).toContain("CDN");
    expect(plant("b.tsx", `export const B = () => <Tile title="Use the DB" className="x" />;`).join()).toContain("DB");
    expect(plant("c.tsx", `export const C = () => <div>{cond ? <b>wait 100 ms</b> : null}</div>;`).join()).toContain("ms");
    expect(plant("d.tsx", `export const D = () => { say("e.g. a cache"); return null; };`).join()).toContain("e.g.");
    expect(plant("f.tsx", `export const F = () => <p>{["Add an LB here"].map((t) => <b key={t}>{t}</b>)}</p>;`).join()).toContain("LB");   // a sentence containing an icon id is still scanned
    expect(plant("e.tsx", `export const E = () => <div className="app info" style={{ color: "red" }}>fine</div>;`).join()).not.toContain("info");
  });

  it("the scanner itself catches a planted abbreviation", () => {
    for (const bad of ["Add a CDN", "wait 100 ms", "an app server", "e.g. a cache"]) expect(() => plain(bad, "self-test")).toThrow();
  });

  it("the narration the match package produces: warnings, results, and every round of real matches", () => {
    for (const c of Object.values(CATEGORY_TEXT)) { plain(c.title, "warning"); plain(c.detail, "warning"); }
    for (const w of [true, false]) for (const k of ["health", "cheaper", "faster", "simpler", "forfeit"] as const) plain(RESULT_REASON_TEXT[k](w), `result ${k}`);
    plain(RESULT_REASON_TEXT.even(), "result even");
    let lines = 0;
    for (const seed of [3, 8, 21]) {
      const { state } = runBotMatch({ id: "t", seed, mode: "practice", scenarioId: "linksmash", handles: ["A", "B"] }, ["normal", "hard"]);
      for (const log of state.siege.log) for (const seat of [0, 1] as const) for (const l of describeRound(log, seat)) { plain(l, "round narration"); lines++; }
      if (state.result) { const e = explainResult(state.result, 0); plain(e.headline, "headline"); plain(e.why, "why"); }
    }
    expect(lines).toBeGreaterThan(30);
  });
});
