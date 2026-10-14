import type { Design, PartId } from "@sysd/sim";
import { autoLayout, buildGenome, type Genome } from "@sysd/match";
import { apply, createRun, upgradeById, type Intent, type RunState } from "@sysd/run";

/**
 * Plays the run mode with the real rules, to find out whether the game is winnable, and whether doing nothing is.
 * "sensible" tries many service shapes each wave and keeps the cheapest one that fails the fewest visitors.
 */
export type Style = "sensible" | "idle" | "thrifty";

const shapes = (): Genome[] => {
  const out: Genome[] = [];
  for (const apps of [1, 2, 3, 4, 5]) for (const cache of [false, true]) for (const cdn of [false, true])
    for (const replicas of [0, 1, 2]) for (const queue of [false, true]) for (const limiter of [false, true])
      out.push({ apps, cache, cdn, replicas, queue, limiter, breaker: false, retries: 2, idempotent: false });
  return out;
};
const SHAPES = shapes();

/** keep the ids you already have, so pieces you keep are not bought a second time */
function reuseIds(fresh: Design, current: Design): Design {
  const pool = new Map<PartId, string[]>();
  for (const n of [...current.nodes].sort((a, b) => (a.id < b.id ? -1 : 1))) pool.set(n.part, [...(pool.get(n.part) ?? []), n.id]);
  const used = new Set<string>();
  const map = new Map<string, string>();
  let counter = Math.max(100, ...current.nodes.map((n) => Number(/-(\d+)$/.exec(n.id)?.[1] ?? 0)));
  for (const n of fresh.nodes) {
    const free = (pool.get(n.part) ?? []).find((id) => !used.has(id));
    const id = free ?? `n0-${++counter}`;
    used.add(id); map.set(n.id, id);
  }
  return {
    nodes: fresh.nodes.map((n) => ({ id: map.get(n.id) as string, part: n.part })),
    edges: fresh.edges.map((e) => ({ ...e, from: map.get(e.from) as string, to: map.get(e.to) as string })),
    policy: current.policy,
  };
}

const needs = (g: Genome): PartId[] => {
  const p: PartId[] = ["LB", "DB"]; for (let i = 0; i < g.apps; i++) p.push("APP");
  if (g.cache) p.push("CACHE"); if (g.cdn) p.push("CDN"); for (let i = 0; i < g.replicas; i++) p.push("REPLICA");
  if (g.queue) p.push("QUEUE", "WORKER"); if (g.limiter) p.push("RATELIMIT");
  return p;
};

export function playRun(seed: number, style: Style): { state: RunState; reached: number; intents: Intent[] } {
  let s = createRun(seed);
  const intents: Intent[] = [];
  const step = (i: Intent): boolean => { const r = apply(s, i); if (r.ok) { s = r.state; intents.push(i); } return r.ok; };
  step({ k: "story.done" });
  for (let guard = 0; guard < 80 && s.phase !== "over"; guard++) {
    if (s.phase === "prepare") {
      let best: { design: Design; failed: number; cost: number } | null = null;
      if (style !== "idle") {
        for (const g of SHAPES) {
          if (!needs(g).every((p) => s.unlocked.includes(p))) continue;
          const design = reuseIds(buildGenome(g), s.design);
          const r = apply(s, { k: "wave.start", design, layout: autoLayout(design) });
          if (!r.ok || !r.state.last) continue;
          const failed = r.state.last.failed, cost = r.state.last.spent - r.state.last.refunded;
          const score = style === "thrifty" ? failed + cost * 600 : failed + cost * 30;   // a sensible player values money a little; a thrifty one a lot
          const bestScore = best ? best.failed + best.cost * (style === "thrifty" ? 600 : 30) : Infinity;
          if (score < bestScore) best = { design, failed, cost };
        }
      }
      const design = best?.design ?? s.design;
      if (!step({ k: "wave.start", design, layout: autoLayout(design) })) { if (!step({ k: "wave.start", design: s.design, layout: s.layout })) break; }
    } else if (s.phase === "result") step({ k: "result.done" });
    else if (s.phase === "reward") {
      const next = s.waves[s.wave];
      const pick = s.offered.find((id) => next && upgradeById(id)?.helps.includes(next.kind)) ?? s.offered[0] as string;
      step({ k: "reward.pick", id: pick });
    }
  }
  return { state: s, reached: s.history.length, intents };
}
