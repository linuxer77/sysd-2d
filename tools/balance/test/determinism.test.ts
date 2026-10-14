import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NO_CARRY, canonicalJson, hash, makeRng, simulate, type Design, type Mods } from "@sysd/sim";
import { LINKSMASH, RULESET, applyAttack, baseMods } from "@sysd/shared";
import { ARCHETYPES } from "../src/archetypes.js";

const sim = (design: Design, mods: Mods = baseMods(30)) =>
  hash(canonicalJson(simulate({ design, ruleset: RULESET, scenario: LINKSMASH, mods, carry: NO_CARRY })));

const stressed = applyAttack(applyAttack(baseMods(30), "FLUSH"), "SPIKE");

describe("determinism", () => {
  it("the same input hashes identically across 80 runs", () => {
    for (const [name, d] of Object.entries(ARCHETYPES)) {
      const first = sim(d, stressed);
      for (let i = 0; i < 80; i++) if (sim(d, stressed) !== first) throw new Error(`${name} diverged on run ${i}`);
    }
  });

  it("node and edge ORDER never changes the result (catches float summation-order bugs)", () => {
    const rng = makeRng(1234);
    for (const [name, d] of Object.entries(ARCHETYPES)) {
      const want = sim(d, stressed);
      for (let i = 0; i < 25; i++) {
        const shuffle = <T,>(xs: readonly T[]): T[] => {
          const a = [...xs];
          for (let k = a.length - 1; k > 0; k--) { const j = rng.int(k + 1); [a[k], a[j]] = [a[j]!, a[k]!]; }
          return a;
        };
        expect(sim({ ...d, nodes: shuffle(d.nodes), edges: shuffle(d.edges) }, stressed), `${name} #${i}`).toBe(want);
      }
    }
  });

  it("survives a JSON round trip (what actually crosses the wire)", () => {
    for (const d of Object.values(ARCHETYPES)) {
      expect(sim(JSON.parse(JSON.stringify(d)) as Design, stressed)).toBe(sim(d, stressed));
    }
  });

  it("never mutates its inputs (deep-frozen input does not throw)", () => {
    const deepFreeze = <T,>(o: T): T => {
      if (o && typeof o === "object") { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); }
      return o;
    };
    const input = deepFreeze({
      design: structuredClone(ARCHETYPES.queued!), ruleset: structuredClone(RULESET),
      scenario: structuredClone(LINKSMASH), mods: structuredClone(stressed), carry: NO_CARRY,
    });
    expect(() => simulate(input)).not.toThrow();
  });
});

describe("the engine source is ambient-free", () => {
  const dir = join(__dirname, "../../../packages/sim/src");
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
  // transcendental functions are NOT pinned by IEEE-754; ambient state is nondeterministic
  const banned = [
    /\bDate\b/, /Math\.random/, /\bperformance\b/, /\bprocess\./, /\bglobalThis\b/, /\bsetTimeout\b/,
    /Math\.(pow|exp|log|log2|log10|sin|cos|tan|atan|atan2|cbrt|hypot|fround)\b/, /\*\*/,
  ];
  for (const f of files) {
    it(`${f} uses no banned globals or transcendentals`, () => {
      const src = readFileSync(join(dir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      for (const re of banned) expect(src, `${f} matches ${re}`).not.toMatch(re);
    });
  }

  const code = (path: string): string => readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");   // comments are not imports

  it("packages/sim imports nothing outside itself (dependency direction)", () => {
    for (const f of files) {
      const src = code(join(dir, f));
      for (const m of src.matchAll(/from\s+["']([^"']+)["']/g)) expect(m[1], `${f} imports ${m[1]}`).toMatch(/^\.\.?\//);
    }
  });

  it("packages/shared imports only @sysd/sim and relatives", () => {
    const sdir = join(__dirname, "../../../packages/shared/src");
    for (const f of readdirSync(sdir).filter((x) => x.endsWith(".ts"))) {
      for (const m of code(join(sdir, f)).matchAll(/from\s+["']([^"']+)["']/g))
        expect(m[1], `${f} imports ${m[1]}`).toMatch(/^(\.\.?\/|@sysd\/sim$)/);
    }
  });
});
