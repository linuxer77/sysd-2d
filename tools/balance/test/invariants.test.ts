import { describe, expect, it } from "vitest";
import { NO_CARRY, damage, makeRng, simulate, type Design, type PartId, type SimResult } from "@sysd/sim";
import { ATTACKS, LINKSMASH, RULESET, applyAttack, baseMods, type AttackId } from "@sysd/shared";
import { ARCHETYPES, DEFAULT_POLICY } from "../src/archetypes.js";

const ATTACK_IDS = Object.keys(ATTACKS) as AttackId[];

/** A random but valid layered stack; every node id is unique and every edge is capability-legal. */
function randomDesign(seed: number): Design {
  const rng = makeRng(seed);
  const nodes: { id: string; part: PartId }[] = [{ id: "c", part: "CLIENT" }];
  const edges: { from: string; to: string }[] = [];
  const apps = 1 + rng.int(4);
  nodes.push({ id: "l", part: "LB" }); edges.push({ from: "c", to: "l" });
  for (let i = 0; i < apps; i++) { nodes.push({ id: `a${i}`, part: "APP" }); edges.push({ from: "l", to: `a${i}` }); }
  nodes.push({ id: "d", part: "DB" });
  const useCache = rng.next() < 0.7;
  if (useCache) { nodes.push({ id: "k", part: "CACHE" }); edges.push({ from: "k", to: "d" }); }
  for (let i = 0; i < apps; i++) {
    if (useCache) edges.push({ from: `a${i}`, to: "k" });
    edges.push({ from: `a${i}`, to: "d" });
  }
  return {
    nodes, edges,
    policy: { ...DEFAULT_POLICY, retries: rng.int(5), breaker: rng.next() < 0.5, idempotentWrites: rng.next() < 0.5 },
  };
}

const run = (d: Design, attacks: AttackId[]): SimResult => {
  let m = baseMods(30);
  for (const a of attacks) m = applyAttack(m, a);
  return simulate({ design: d, ruleset: RULESET, scenario: LINKSMASH, mods: m, carry: NO_CARRY }).result;
};

describe("invariants over 150 random designs x every attack", () => {
  const seeds = Array.from({ length: 150 }, (_, i) => 1000 + i);

  it("probabilities stay in [0,1], percentiles are ordered, nothing is NaN", () => {
    for (const s of seeds) {
      const d = randomDesign(s);
      for (const a of [[], ...ATTACK_IDS.map((x) => [x])] as AttackId[][]) {
        const r = run(d, a);
        for (const c of [r.read, r.write]) {
          for (const v of [c.attemptFail, c.userFail, c.slowFrac, c.badFrac, c.timedOutFrac]) {
            expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1);
          }
          expect(c.p50Ms).toBeLessThanOrEqual(c.p99Ms + 1e-9);
          expect(c.amplification).toBeGreaterThanOrEqual(1 - 1e-9);
          for (const v of Object.values(c)) expect(Number.isFinite(v)).toBe(true);
        }
        for (const n of r.nodes) { expect(n.util).toBeGreaterThanOrEqual(0); expect(Number.isFinite(n.latMs)).toBe(true); }
        expect(damage(r, LINKSMASH, RULESET, 30).total).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("retries 0 never amplifies; breaker on never amplifies more than breaker off", () => {
    for (const s of seeds) {
      const d = randomDesign(s);
      const none = run({ ...d, policy: { ...d.policy, retries: 0 } }, ["SPIKE"]);
      expect(none.read.amplification).toBe(1);
      const off = run({ ...d, policy: { ...d.policy, retries: 3, breaker: false } }, ["SPIKE"]);
      const on = run({ ...d, policy: { ...d.policy, retries: 3, breaker: true } }, ["SPIKE"]);
      expect(on.read.amplification).toBeLessThanOrEqual(off.read.amplification + 1e-9);
    }
  });

  it("adding an app server never makes a spike worse", () => {
    for (const s of seeds.slice(0, 60)) {
      const d = randomDesign(s);
      const more: Design = {
        ...d,
        nodes: [...d.nodes, { id: "ax", part: "APP" }],
        edges: [...d.edges, { from: "l", to: "ax" }, { from: "ax", to: "d" }, ...(d.nodes.some((n) => n.id === "k") ? [{ from: "ax", to: "k" }] : [])],
      };
      const before = damage(run(d, ["SPIKE"]), LINKSMASH, RULESET, 30).total;
      const after = damage(run(more, ["SPIKE"]), LINKSMASH, RULESET, 30).total;
      expect(after).toBeLessThanOrEqual(before + 1e-6);
    }
  });

  it("a stronger attack never does less damage (spike vs flush+spike), for designs without a breaker", () => {
    // A circuit breaker gives the retry loop TWO stable states (storm / breaker-open). A harder hit
    // can push a stack into the breaker-open state and genuinely take less damage: real
    // metastable-failure behaviour, deterministic but not monotone. So strict monotonicity only
    // holds without a breaker; the breaker has its own property below.
    for (const s of seeds) {
      const d = randomDesign(s);
      if (d.policy.breaker) continue;
      const a = damage(run(d, ["SPIKE"]), LINKSMASH, RULESET, 30).total;
      const b = damage(run(d, ["FLUSH", "SPIKE"]), LINKSMASH, RULESET, 30).total;
      expect(b, `seed ${s}`).toBeGreaterThanOrEqual(a - 1e-6);
    }
  });

  it("a circuit breaker never makes the same stack worse off (the property the lesson actually claims)", () => {
    let strictlyBetter = 0;
    for (const s of seeds) {
      const d = randomDesign(s);
      for (const atk of ["SPIKE", "WRITE_STORM", "LAG"] as AttackId[]) {
        const off = damage(run({ ...d, policy: { ...d.policy, breaker: false } }, [atk]), LINKSMASH, RULESET, 30).total;
        const on = damage(run({ ...d, policy: { ...d.policy, breaker: true } }, [atk]), LINKSMASH, RULESET, 30).total;
        expect(on, `seed ${s} ${atk}`).toBeLessThanOrEqual(off + 0.5);
        if (on < off - 1) strictlyBetter++;
      }
    }
    expect(strictlyBetter).toBeGreaterThan(10);      // and it must actually help somewhere
  });

  it("queue depth stays within [0, maxDepth] across many rounds", () => {
    const d = ARCHETYPES.queued!;
    let carry = NO_CARRY;
    for (let round = 0; round < 20; round++) {
      const m = applyAttack(baseMods(30), round % 2 ? "WRITE_STORM" : "SPIKE");
      const out = simulate({ design: d, ruleset: RULESET, scenario: LINKSMASH, mods: { ...m, writeSpikeMul: m.writeSpikeMul * 60 }, carry });
      carry = out.carry;
      const depth = carry.queueDepth.q ?? 0;
      expect(depth).toBeGreaterThanOrEqual(0);
      expect(depth).toBeLessThanOrEqual(RULESET.parts.QUEUE.queueMaxDepth!);
    }
  });
});
