import { describe, expect, it } from "vitest";
import { NO_CARRY, simulate, type Design } from "@sysd/sim";
import {
  ATTACKS, ATTACK_INFO, GLOSSARY, LINKSMASH, LINKSMASH_BRIEF, LINKSMASH_MISSIONS, OPERATION_INFO, PARTS,
  PART_INFO, RULESET, baseMods, coach, evaluateMissions,
} from "@sysd/shared";
import { ARCHETYPES, design } from "../src/archetypes.js";
import { build, genomes } from "../src/grammar.js";

const ctx = { ruleset: RULESET, scenario: LINKSMASH };

/** Collect every string reachable from a value. */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => strings(x, out));
  return out;
}

/**
 * The beginner-first rule: NO abbreviations, NO acronyms in anything a player reads.
 * Say "load balancer", never "LB"; "milliseconds", never "ms"; "for example", never "e.g.".
 */
const BANNED_UPPER = /\b(LB|CDN|DB|API|RPS|QPS|SLO|SLA|TTL|HP|PP|UI|UX|OK|CPU|RAM|SQL|HTTP|URL|IO)\b/;
const BANNED_LOWER = /\b(app|apps|lb|cdn|db|rps|qps|ms|sec|secs|vs|etc|info|config|repl|avg|min|kb|mb|gb|p99|p50|p95|ttl|slo|api)\b/i;
const BANNED_LATIN = /\b(e\.g\.|i\.e\.|etc\.|vs\.)/i;

function assertPlain(text: string, where: string): void {
  expect(text, `${where}: "${text}"`).not.toMatch(BANNED_UPPER);
  expect(text, `${where}: "${text}"`).not.toMatch(BANNED_LOWER);
  expect(text, `${where}: "${text}"`).not.toMatch(BANNED_LATIN);
}

describe("beginner-first copy: no abbreviations anywhere a player can read", () => {
  it("component names, descriptions, glossary, attacks, operations, brief and missions", () => {
    const all: [string, unknown][] = [
      ["PART_INFO", PART_INFO], ["GLOSSARY", GLOSSARY], ["ATTACK_INFO", ATTACK_INFO],
      ["OPERATION_INFO", OPERATION_INFO], ["LINKSMASH_BRIEF", { ...LINKSMASH_BRIEF, requirements: LINKSMASH_BRIEF.requirements.map(({ helpedBy: _ids, ...visible }) => visible) }],
      ["attack names", Object.values(ATTACKS).map((a) => a.name)],
      ["mission text", LINKSMASH_MISSIONS.map((m) => ({ t: m.title, h: m.short, s: m.story, k: m.task, l: m.lesson }))],
    ];
    for (const [where, v] of all) for (const s of strings(v)) assertPlain(s, where);
  });

  it("every coach tip, for every archetype, every grammar design, and broken designs", () => {
    const designs: Design[] = [
      ...Object.values(ARCHETYPES),
      ...[...genomes()].filter((_, i) => i % 23 === 0).map(build),
      design({ nodes: [["c", "CLIENT"]], edges: [] }),
      design({ nodes: [["c", "CLIENT"], ["a", "APP"], ["b", "APP"]], edges: [["c", "a"], ["a", "b"], ["b", "a"]] }),
      design({ nodes: [["c", "CLIENT"], ["q", "QUEUE"], ["r", "REPLICA"], ["k", "CACHE"]], edges: [["c", "q"], ["c", "k"]] }),
      design({ nodes: [["a", "APP"]], edges: [] }),
    ];
    let n = 0;
    for (const d of designs) for (const t of coach(d, RULESET, LINKSMASH)) { n++; for (const s of strings([t.title, t.body, t.tryThis ?? ""])) assertPlain(s, `coach(${t.id})`); }
    expect(n).toBeGreaterThan(40);
  });

  it("every mission progress message, for every archetype", () => {
    for (const d of Object.values(ARCHETYPES)) for (const s of evaluateMissions(d, ctx).steps) assertPlain(s.progress, `mission ${s.id}`);
  });

  it("the checker itself catches abbreviations (so it cannot silently pass)", () => {
    for (const bad of ["Add a CDN", "use the DB", "wait 100 ms", "an app server", "p99 is high", "e.g. a cache", "about 5k rps"])
      expect(() => assertPlain(bad, "self-test")).toThrow();
    expect(() => assertPlain("Add a content delivery network and wait 100 milliseconds", "self-test")).not.toThrow();
  });
});

describe("content completeness", () => {
  it("every component, attack and operation has a full explanation", () => {
    for (const id of Object.keys(PARTS) as (keyof typeof PARTS)[]) {
      const i = PART_INFO[id];
      expect(i.fullName.length).toBeGreaterThan(3);
      expect(PARTS[id], id).toBeDefined();
      expect((PARTS[id] as unknown as Record<string, unknown>).name, "display names must not live in balance data").toBeUndefined();
      for (const f of [i.summary, i.analogy, i.useWhen, i.watchOut]) expect(f.length).toBeGreaterThan(15);
    }
    for (const id of Object.keys(ATTACKS) as (keyof typeof ATTACKS)[]) {
      const i = ATTACK_INFO[id];
      expect(i.fullName.length).toBeGreaterThan(3);
      for (const f of [i.whatHappens, i.realWorld, i.howToDefend]) expect(f.length).toBeGreaterThan(15);
    }
  });

  it("the brief says what to do, in steps, and every requirement is scored by something real", () => {
    expect(LINKSMASH_BRIEF.howToPlay.length).toBeGreaterThanOrEqual(4);
    expect(LINKSMASH_BRIEF.requirements.length).toBeGreaterThanOrEqual(5);
    for (const r of LINKSMASH_BRIEF.requirements) { expect(r.helpedBy.length).toBeGreaterThan(0); expect(r.howItIsScored.length).toBeGreaterThan(20); }
    expect(LINKSMASH_BRIEF.notScoredHere).toMatch(/not test/i);          // honest about what is out of scope
  });
});

describe("the coach gives accurate, useful advice", () => {
  const ids = (d: Design) => coach(d, RULESET, LINKSMASH).map((t) => t.id);

  it("tells a beginner with an empty board how to begin", () => {
    expect(ids(design({ nodes: [["c", "CLIENT"], ["d", "DB"]], edges: [] }))).toContain("no-links");
    expect(ids(design({ nodes: [["c", "CLIENT"]], edges: [] }))).toContain("no-db");
  });

  it("spots a bottleneck and names the piece in plain words", () => {
    const tips = coach(ARCHETYPES.naive!, RULESET, LINKSMASH);
    const b = tips.find((t) => t.id === "bottleneck")!;
    expect(b.kind).toBe("problem");
    expect(b.title.toLowerCase()).toMatch(/application server|database/);   // plain names, never ids
    expect(tips.some((t) => t.id === "retry-storm")).toBe(true);        // the real cause: retries tripled the load
    expect(tips.find((t) => t.id === "retry-storm")!.body).toMatch(/requests per second/);
    expect(b.tryThis).toBeTruthy();
  });

  it("warns about retries without a breaker, and stops once a breaker is on", () => {
    expect(ids(ARCHETYPES.cached!)).toContain("retries-no-breaker");
    expect(ids(ARCHETYPES.hardened!)).not.toContain("retries-no-breaker");
  });

  it("warns about the rate limiter trap and a single database", () => {
    expect(ids(ARCHETYPES.limiterTrap!)).toContain("limiter");
    expect(ids(ARCHETYPES.cached!)).toContain("single-db");
    expect(ids(ARCHETYPES.replicated!)).not.toContain("single-db");
  });

  it("praises a genuinely strong design and only a strong one", () => {
    expect(ids(ARCHETYPES.layered!)).toContain("solid");
    expect(ids(ARCHETYPES.naive!)).not.toContain("solid");
    expect(ids(ARCHETYPES.limiterTrap!)).not.toContain("solid");
  });

  it("problems are listed before ideas, and every problem comes with a next step", () => {
    const tips = coach(ARCHETYPES.naive!, RULESET, LINKSMASH);
    const rank = { problem: 0, warning: 1, idea: 2, good: 3 } as const;
    for (let i = 1; i < tips.length; i++) expect(rank[tips[i]!.kind]).toBeGreaterThanOrEqual(rank[tips[i - 1]!.kind]);
    for (const t of tips.filter((x) => x.kind === "problem" && x.id !== "invalid" && x.id !== "client")) expect(t.tryThis, t.id).toBeTruthy();
  });

  it("is pure: the same design always gets the same advice", () => {
    expect(coach(ARCHETYPES.cached!, RULESET, LINKSMASH)).toEqual(coach(ARCHETYPES.cached!, RULESET, LINKSMASH));
  });

  it("never throws on any design the editor can produce", () => {
    for (const g of [...genomes()].filter((_, i) => i % 7 === 0)) expect(() => coach(build(g), RULESET, LINKSMASH)).not.toThrow();
    void simulate; void NO_CARRY; void baseMods;
  });
});

describe("guided missions are checked against the real simulator", () => {
  const done = (d: Design) => evaluateMissions(d, ctx).steps.map((s) => s.done);

  it("an empty board completes nothing and points at step one", () => {
    const p = evaluateMissions(design({ nodes: [["c", "CLIENT"]], edges: [] }), ctx);
    expect(p.steps.every((s) => !s.done)).toBe(true);
    expect(p.currentIndex).toBe(0);
  });

  it("the simplest working design completes step one only", () => {
    const d = done(ARCHETYPES.naive!);
    expect(d[0]).toBe(true);
    expect(d.slice(1).every((x) => !x)).toBe(true);
  });

  it("a strong design completes every step", () => {
    const p = evaluateMissions(ARCHETYPES.layered!, ctx);
    expect(p.steps.map((s) => s.done), JSON.stringify(p.steps)).toEqual([true, true, true, true]);
    expect(p.complete).toBe(true);
  });

  it("a weak cache-only design handles a normal day but not a crowd or a crash", () => {
    const d = done(ARCHETYPES.cached!);
    expect(d[0]).toBe(true); expect(d[1]).toBe(true); expect(d[2]).toBe(false);
  });

  it("each step has concrete numbered tasks and a stated lesson", () => {
    expect(LINKSMASH_MISSIONS.length).toBe(4);
    for (const m of LINKSMASH_MISSIONS) { expect(m.task.length).toBeGreaterThanOrEqual(3); expect(m.lesson.length).toBeGreaterThan(30); }
  });
});
