import { describe, expect, it } from "vitest";
import { NO_CARRY, NO_MODS, simulate, visitors, type Design, type Mods } from "@sysd/sim";
import { LINKSMASH, PART_INFO, baseMods } from "@sysd/shared";
import { autoLayout, buildGenome, type Genome } from "@sysd/match";
import {
  KIND_INFO, UPGRADES, apply, createRun, makeWaves, modsForWave, reasonFor, replayRun, rulesetFor, runHash, scenarioFor, summaryLine,
  type Intent, type WaveKind,
} from "@sysd/run";
import { playRun } from "../src/runbot.js";

const G: Genome = { apps: 2, cache: true, cdn: false, replicas: 0, queue: false, limiter: false, breaker: false, retries: 2, idempotent: false };
const run = (d: Design, m: Mods, rps = 6000, rs = rulesetFor([])) => {
  const r = simulate({ design: d, ruleset: rs, scenario: { ...LINKSMASH, rps }, mods: m, carry: NO_CARRY }).result;
  return { r, v: visitors(r, 30) };
};

describe("new simulator inputs", () => {
  it("every default changes nothing", () => {
    const d = buildGenome(G);
    const plain = run(d, baseMods(30)).r;
    const neutral = run(d, { ...baseMods(30), uniqueReadFrac: 0, hitBoost: 0, botRps: 0, botBlock: {}, partCapMul: {}, warmupMul: 1 }).r;
    expect(neutral).toEqual(plain);
    expect(NO_MODS.botRps).toBeUndefined();
  });
  it("links nobody asked for before get past the cache and land on the database", () => {
    const d = buildGenome(G);
    const db = (m: Mods) => run(d, m, 3000).r.nodes.find((n) => n.part === "DB")!.loadR;
    expect(db({ ...baseMods(30), uniqueReadFrac: 0.8 })).toBeGreaterThan(db(baseMods(30)) * 2);
  });
  it("popular links make a cache answer more", () => {
    const d = buildGenome(G);
    const db = (m: Mods) => run(d, m, 3000).r.nodes.find((n) => n.part === "DB")!.loadR;
    expect(db({ ...baseMods(30), hitBoost: 0.3 })).toBeLessThan(db(baseMods(30)));
  });
  it("bots use up capacity but are never counted as failed visitors, and a limiter removes them", () => {
    const plain = buildGenome({ ...G, apps: 3 }), gated = buildGenome({ ...G, apps: 3, limiter: true });
    const bots: Mods = { ...baseMods(30), botRps: 12000, botBlock: { RATELIMIT: 0.92 } };
    const none = run(plain, baseMods(30), 3000).v, swarmed = run(plain, bots, 3000).v, defended = run(gated, bots, 3000).v;
    expect(swarmed.offered).toBe(none.offered);                  // bots are not visitors, so the count of visitors does not move
    expect(swarmed.failed).toBeGreaterThan(none.failed + 1000);  // but they crowd real visitors out
    expect(defended.failed).toBeLessThan(swarmed.failed * 0.3);  // the limiter turns them away
  });
  it("a capacity multiplier on one part makes that part fill up sooner", () => {
    const d = buildGenome(G);
    const util = (m: Mods) => run(d, m, 4000).r.nodes.find((n) => n.part === "APP")!.util;
    expect(util({ ...baseMods(30), partCapMul: { APP: 0.5 } })).toBeGreaterThan(util(baseMods(30)) * 1.8);
  });
  it("a cache that refills faster costs fewer visitors after a wipe", () => {
    const d = buildGenome({ ...G, apps: 3 });
    const wiped = (w: number) => run(d, { ...baseMods(30), flush: true, warmupMul: w }, 6000).v.failed;
    expect(wiped(0.5)).toBeLessThanOrEqual(wiped(1));
  });
  it("failed visitors are graded: a little overload costs a little", () => {
    const d = buildGenome({ ...G, apps: 1, cache: false });
    const rps = (n: number) => run(d, baseMods(30), n).v.failed;
    expect(rps(1500)).toBeLessThan(rps(5200));
    expect(rps(5200)).toBeLessThan(rps(9000));
  });
});

const KINDS: WaveKind[] = ["busy", "viral", "crawler", "bots", "saving", "slow", "boss"];

describe("waves", () => {
  it("a seed fixes the whole act: two plain days, five different problems, then the boss", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const w = makeWaves(seed);
      expect(w.map((x) => x.kind).slice(0, 2)).toEqual(["busy", "busy"]);
      expect(w[7]!.kind).toBe("boss");
      expect(new Set(w.slice(2, 7).map((x) => x.kind)).size).toBe(5);
      expect(makeWaves(seed)).toEqual(w);
      for (let i = 1; i < w.length; i++) expect(w[i]!.rps).toBeGreaterThan(w[i - 1]!.rps);
    }
    expect(new Set([1, 2, 3, 4, 5, 6, 7, 8].map((s) => makeWaves(s).slice(2, 7).map((x) => x.kind).join())).size).toBeGreaterThan(3);
  });

  /** Every kind of wave must have a piece that answers it, measured by the real simulator. */
  const counters: Record<WaveKind, { rps: number; weak: Partial<Genome>; strong: Partial<Genome> }> = {
    busy: { rps: 5000, weak: { apps: 1, cache: false }, strong: { apps: 2, cache: true } },
    viral: { rps: 4400, weak: { apps: 3, cache: false }, strong: { apps: 3, cache: true } },
    crawler: { rps: 4400, weak: { apps: 3, cache: true }, strong: { apps: 3, cache: true, replicas: 1 } },
    bots: { rps: 4400, weak: { apps: 3 }, strong: { apps: 3, limiter: true } },
    saving: { rps: 5800, weak: { apps: 3 }, strong: { apps: 3, replicas: 2, queue: true } },
    slow: { rps: 4400, weak: { apps: 2 }, strong: { apps: 3 } },
    boss: { rps: 11000, weak: { apps: 2 }, strong: { apps: 5, replicas: 2, cdn: true } },
  };
  for (const kind of KINDS) {
    it(`"${kind}" has an answer: the right piece measurably saves visitors`, () => {
      const rps = counters[kind].rps;
      const wave = { n: 1, kind, rps };
      const failed = (g: Partial<Genome>): number => {
        const d = buildGenome({ ...G, ...g });
        const rs = rulesetFor([]);
        const calm = simulate({ design: d, ruleset: rs, scenario: scenarioFor(rps), mods: baseMods(30), carry: NO_CARRY }).result;
        const util = Object.fromEntries(calm.nodes.map((n) => [n.id, n.util]));
        const mods = modsForWave(wave, d, util, { partCapMul: {}, warmupMul: 1 });
        return visitors(simulate({ design: d, ruleset: rs, scenario: scenarioFor(rps), mods, carry: NO_CARRY }).result, 30).failed;
      };
      const weak = failed(counters[kind].weak), strong = failed(counters[kind].strong);
      expect(strong, `${kind}: weak ${weak}, strong ${strong}`).toBeLessThan(weak * 0.7);
    });
  }
});

describe("the run", () => {
  it("the same seed and the same moves always end in the same place", () => {
    for (const seed of [1, 2, 3]) {
      const a = playRun(seed, "sensible");
      const again = replayRun(seed, a.intents);
      expect(runHash(again)).toBe(runHash(a.state));
    }
  });
  it("rejects moves that are not allowed, in plain words", () => {
    const s = createRun(5);
    expect(apply(s, { k: "wave.start", design: s.design, layout: s.layout })).toMatchObject({ ok: false });
    const r1 = apply(s, { k: "story.done" });
    if (!r1.ok) throw new Error("story");
    const bigger = buildGenome({ ...G, apps: 5, replicas: 2, cdn: true });
    const r2 = apply(r1.state, { k: "wave.start", design: bigger, layout: autoLayout(bigger) });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toMatch(/not unlocked|unlocked|need \$/);
    expect(apply(r1.state, { k: "reward.pick", id: "m-cash" })).toMatchObject({ ok: false });
  });
  it("money never goes below zero and the allowance only ever drops", () => {
    for (let seed = 1; seed <= 5; seed++) for (const style of ["sensible", "thrifty", "idle"] as const) {
      const { state } = playRun(seed, style);
      let left = state.allowanceMax;
      for (const h of state.history) { expect(h.allowanceAfter).toBeLessThanOrEqual(left); left = h.allowanceAfter; }
      expect(state.money).toBeGreaterThanOrEqual(0);
    }
  });
  it("a boost never makes a wave worse", () => {
    const seed = 4;
    const base = createRun(seed);
    const go = (owned: string[]): number => {
      let s = { ...base, owned, phase: "prepare" as const };
      const d = buildGenome({ ...G, apps: 3, cache: true, replicas: 1 });
      s = { ...s, design: d, layout: autoLayout(d), money: 999, unlocked: ["LB", "APP", "CACHE", "DB", "REPLICA"] };
      const r = apply(s, { k: "wave.start", design: d, layout: autoLayout(d) });
      if (!r.ok) throw new Error(r.reason);
      return r.state.last!.failed;
    };
    const plain = go([]);
    for (const id of ["b-servers", "b-cache", "b-database", "b-breaker", "b-retry", "b-refill"]) expect(go([id]), id).toBeLessThanOrEqual(plain);
  });
  it("the unlock rewards unlock exactly what they say", () => {
    const s0 = createRun(9);
    const s = { ...s0, phase: "reward" as const, offered: ["p-queue"], wave: 1 };
    const r = apply(s, { k: "reward.pick", id: "p-queue" });
    if (!r.ok) throw new Error(r.reason);
    expect(r.state.unlocked).toEqual(expect.arrayContaining(["QUEUE", "WORKER"]));
    expect(r.state.phase).toBe("prepare");
    expect(r.state.wave).toBe(2);
  });
});

describe("the difficulty is sensible", () => {
  const N = 8;
  const score = (style: "sensible" | "thrifty" | "idle") => { let won = 0, waves = 0; for (let seed = 1; seed <= N; seed++) { const { state } = playRun(seed, style); if (state.outcome === "won") won++; waves += state.history.length; } return { won, waves: waves / N }; };
  it("doing nothing always loses early; careful play usually wins; careless play sometimes does", () => {
    const idle = score("idle"), thrifty = score("thrifty"), sensible = score("sensible");
    expect(idle.won).toBe(0);
    expect(idle.waves).toBeLessThan(5);
    expect(sensible.won).toBeGreaterThanOrEqual(Math.floor(N * 0.7));
    expect(thrifty.won).toBeLessThanOrEqual(sensible.won);
    expect(thrifty.waves).toBeLessThan(sensible.waves);
  });
});

describe("run copy is plain language", () => {
  const BANNED_UPPER = /\b(LB|CDN|DB|API|RPS|QPS|SLO|SLA|TTL|HP|PP|UI|UX|OK|CPU|RAM|SQL|HTTP|URL|IO)\b/;
  const BANNED_LOWER = /\b(app|apps|lb|cdn|db|rps|qps|ms|sec|secs|vs|etc|info|config|repl|avg|min|kb|mb|gb|p99|p50|p95|ttl|slo|api)\b/i;
  const BANNED_LATIN = /\b(e\.g\.|i\.e\.|etc\.|vs\.)/i;
  const plain = (t: string): void => { expect(t, t).not.toMatch(BANNED_UPPER); expect(t, t).not.toMatch(BANNED_LOWER); expect(t, t).not.toMatch(BANNED_LATIN); };
  it("wave cards, upgrade text and generated result sentences", () => {
    for (const k of Object.values(KIND_INFO)) { plain(k.title); plain(k.what); plain(k.answer); }
    for (const u of UPGRADES) { plain(u.name); plain(u.text); }
    for (const seed of [1, 2]) for (const style of ["sensible", "thrifty", "idle"] as const) {
      for (const h of playRun(seed, style).state.history) { plain(reasonFor(h)); plain(summaryLine(h)); }
    }
    expect(Object.keys(PART_INFO).length).toBeGreaterThan(5);
  });
  it("upgrade ids are unique and every kind of wave has at least one upgrade that helps", () => {
    expect(new Set(UPGRADES.map((u) => u.id)).size).toBe(UPGRADES.length);
    for (const kind of KINDS) expect(UPGRADES.some((u) => u.helps.includes(kind)), kind).toBe(true);
    const _i: Intent = { k: "story.done" }; void _i;
  });
});
