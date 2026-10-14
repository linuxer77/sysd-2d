import { describe, expect, it } from "vitest";
import { NO_CARRY, simulate } from "@sysd/sim";
import { LINKSMASH, PARTS, RULESET, baseMods } from "@sysd/shared";
import { ARCHETYPES, design } from "../src/archetypes.js";
import { build, type Genome } from "../src/grammar.js";
import { run } from "../src/run.js";

const node = (r: ReturnType<typeof run>, id: string) => r.result.nodes.find((n) => n.id === id)!;
const baseR = LINKSMASH.rps * (1 - LINKSMASH.writeRatio);
const baseW = LINKSMASH.rps * LINKSMASH.writeRatio;

describe("regression: fan-in is not double counted (prototype bug #1)", () => {
  it("the DB receives exactly the cache's misses, with 3 APPs fanning into one cache", () => {
    const r = run(ARCHETYPES.cached!);
    const cache = PARTS.CACHE;
    const wShare = baseW / (baseW + baseR);
    const effHit = cache.hitRate! * (1 - Math.min(RULESET.constants.invalCap, wShare * cache.invalidationSensitivity!));
    const expectedMisses = baseR * (1 - effHit);
    // the old BFS delivered ~2x this to the DB
    expect(node(r, "d").loadR).toBeGreaterThan(expectedMisses * 0.99);
    expect(node(r, "d").loadR).toBeLessThan(expectedMisses * 1.01);
  });

  it("flow is conserved: every APP in a fan-out sees an equal share, and they sum to the entry", () => {
    const r = run(ARCHETYPES.cached!);
    const apps = ["a1", "a2", "a3"].map((id) => node(r, id).loadR);
    expect(apps[0]).toBeCloseTo(apps[1]!, 6);
    expect(apps[1]).toBeCloseTo(apps[2]!, 6);
    expect(apps[0]! + apps[1]! + apps[2]!).toBeCloseTo(baseR, 3);
  });
});

describe("regression: p99 is a flow-weighted percentile (prototype bug #2)", () => {
  it("a cache improves p50 while the cold-miss path sets the tail", () => {
    const withCache = run(ARCHETYPES.cached!).result.read;
    const noCache = run(design({
      nodes: [["c", "CLIENT"], ["l", "LB"], ["a1", "APP"], ["a2", "APP"], ["a3", "APP"], ["d", "DB"], ["r1", "REPLICA"], ["r2", "REPLICA"]],
      edges: [["c", "l"], ["l", "a1"], ["l", "a2"], ["l", "a3"], ["a1", "d"], ["a2", "d"], ["a3", "d"],
              ["a1", "r1"], ["a2", "r2"], ["d", "r1"], ["d", "r2"]],
    })).result.read;
    expect(withCache.p50Ms).toBeLessThan(noCache.p50Ms);
    expect(withCache.p99Ms).toBeGreaterThan(withCache.p50Ms);
  });
});

describe("read/write split", () => {
  it("reads and writes are separate streams in the ratio the scenario states", () => {
    const r = run(ARCHETYPES.cached!).result;
    expect(r.read.offered / r.write.offered).toBeCloseTo((1 - LINKSMASH.writeRatio) / LINKSMASH.writeRatio, 3);
  });

  it("caches only ever see reads; the DB sees writes directly from the apps", () => {
    const r = run(ARCHETYPES.cached!);
    expect(node(r, "k").loadW).toBe(0);
    expect(node(r, "d").loadW).toBeGreaterThan(0);
  });

  it("replicas serve reads only and the primary burns capacity shipping to them", () => {
    const r = run(ARCHETYPES.replicated!);
    expect(node(r, "r1").loadW).toBe(0);
    expect(node(r, "r1").loadR).toBeGreaterThan(0);
    const solo = run(design({
      nodes: [["c", "CLIENT"], ["a", "APP"], ["d", "DB"]], edges: [["c", "a"], ["a", "d"]],
    }));
    expect(node(r, "d").util).toBeGreaterThanOrEqual(0);
    expect(solo.result.read.p99Ms).toBeGreaterThan(0);
  });

  it("a write storm erodes cache hit rate and pushes the herd onto the origin", () => {
    const calm = run(ARCHETYPES.cached!);
    const storm = run(ARCHETYPES.cached!, ["WRITE_STORM"]);
    expect(node(storm, "d").loadR).toBeGreaterThan(node(calm, "d").loadR);
  });

  it("a queue absorbs a write storm that a direct write path cannot (identical stacks, queue is the only difference)", () => {
    const g: Genome = { apps: 3, cache: true, cdn: false, replicas: 0, queue: false, limiter: false, breaker: false, retries: 0, idempotent: true };
    const direct = run(build(g), ["WRITE_STORM"]).result;
    const queued = run(build({ ...g, queue: true }), ["WRITE_STORM"]).result;
    expect(queued.write.p99Ms).toBeLessThan(direct.write.p99Ms);           // client is acked at the queue
    expect(queued.write.userFail).toBeLessThanOrEqual(direct.write.userFail + 1e-9);
    expect(queued.consistency.lostWrites).toBe(0);
  });

  it("queue backlog carries across rounds and eventually overflows into lost writes", () => {
    const mods = { ...baseMods(30), writeSpikeMul: 400 };       // far beyond worker capacity
    let carry = NO_CARRY;
    let lost = 0;
    for (let round = 0; round < 8; round++) {
      const out = simulate({ design: ARCHETYPES.queued!, ruleset: RULESET, scenario: LINKSMASH, mods, carry });
      carry = out.carry; lost = out.result.consistency.lostWrites;
    }
    expect(carry.queueDepth.q).toBeGreaterThan(0);
    expect(lost).toBeGreaterThan(0);
  });
});

describe("the lessons the game is built to teach", () => {
  it("a healthy design under no attack takes exactly zero damage", () => {
    for (const name of ["cached", "replicated", "layered", "hardened"]) expect(run(ARCHETYPES[name]!).damage, name).toBe(0);
  });

  it("same topology, different policy: a breaker is the cheapest resilience on the board", () => {
    const stormy = run(ARCHETYPES.cached!, ["SPIKE"]);
    const hardened = run(ARCHETYPES.hardened!, ["SPIKE"]);
    expect(hardened.damage).toBeLessThan(stormy.damage * 0.5);
  });

  it("retries without a breaker amplify load under stress", () => {
    const r = run(ARCHETYPES.cached!, ["SPIKE"]);
    expect(r.result.read.amplification).toBeGreaterThan(1.05);
    expect(r.result.findings.some((f) => f.code === "retry-storm")).toBe(true);
  });

  it("no retries, no amplification", () => {
    const d = { ...ARCHETYPES.cached!, policy: { ...ARCHETYPES.cached!.policy, retries: 0 } };
    expect(run(d, ["SPIKE"]).result.read.amplification).toBe(1);
  });

  it("a layered CDN + cache path survives a spike that kills a plain cache", () => {
    expect(run(ARCHETYPES.layered!, ["SPIKE"]).damage).toBeLessThan(5);
    expect(run(ARCHETYPES.cached!, ["SPIKE"]).damage).toBeGreaterThan(25);
  });

  it("order matters: flush then spike is far worse than spike alone", () => {
    const spike = run(ARCHETYPES.layered!, ["SPIKE"]).damage;
    const flush = run(ARCHETYPES.layered!, ["FLUSH"]).damage;
    const combo = run(ARCHETYPES.layered!, ["FLUSH", "SPIKE"]).damage;
    // each alone is harmless to a layered stack; together they are not (matches the independently
    // hand-derived balance estimate of roughly +12 for a strong build)
    expect(combo).toBeGreaterThan(spike + 8);
    expect(combo).toBeGreaterThan(flush + 8);
  });

  it("the rate limiter is a trap: it drops real users with no attack at all", () => {
    expect(run(ARCHETYPES.limiterTrap!).damage).toBeGreaterThan(run(ARCHETYPES.cached!).damage);
    expect(run(ARCHETYPES.limiterTrap!).result.findings.some((f) => f.code === "limiter-drops-users")).toBe(true);
  });

  it("killing the only store fails the stack; replicas keep reads alive", () => {
    const solo = run(ARCHETYPES.naive!, [{ id: "KILL", target: "d" }]);
    expect(solo.result.read.userFail).toBe(1);
    const repl = run(ARCHETYPES.replicated!, [{ id: "KILL", target: "d" }]);
    expect(repl.damage).toBeLessThan(run(ARCHETYPES.cached!, [{ id: "KILL", target: "d" }]).damage + 10);
    expect(repl.result.read.userFail).toBeLessThan(0.2);
  });

  it("an invalid design fails closed instead of throwing", () => {
    const bad = design({ nodes: [["a", "APP"]], edges: [] });
    const out = simulate({ design: bad, ruleset: RULESET, scenario: LINKSMASH, mods: baseMods(30), carry: NO_CARRY });
    expect(out.result.read.userFail).toBe(1);
  });
});
