import type { Design, DesignEdge, DesignNode, PartId } from "@sysd/sim";
import { PARTS } from "@sysd/shared";
import { DEFAULT_POLICY } from "./archetypes.js";

export interface Genome {
  apps: number; cache: boolean; cdn: boolean; replicas: number; queue: boolean; limiter: boolean;
  breaker: boolean; retries: number; idempotent: boolean;
}

/** Every genome in the grammar; the harness filters by budget. */
export function* genomes(): Generator<Genome> {
  for (const apps of [1, 2, 3, 4])
    for (const cache of [false, true]) for (const cdn of [false, true])
      for (const replicas of [0, 1, 2]) for (const queue of [false, true]) for (const limiter of [false, true])
        for (const breaker of [false, true]) for (const retries of [0, 1, 2, 3]) for (const idempotent of [false, true])
          yield { apps, cache, cdn, replicas, queue, limiter, breaker, retries, idempotent };
}

export function build(g: Genome): Design {
  const nodes: DesignNode[] = [{ id: "c", part: "CLIENT" }, { id: "l", part: "LB" }, { id: "d", part: "DB" }];
  const edges: DesignEdge[] = [];
  const add = (id: string, part: PartId): void => { nodes.push({ id, part }); };
  const link = (from: string, to: string): void => { edges.push({ from, to }); };

  let front = "l";                                   // where the client's traffic enters
  if (g.limiter) { add("x", "RATELIMIT"); link("c", "x"); link("x", "l"); } else link("c", "l");
  if (g.cdn) {                                       // reads: client -> cdn -> lb ; writes: client -> lb
    add("n", "CDN"); link(g.limiter ? "x" : "c", "n"); link("n", "l");
  }
  void front;
  for (let i = 0; i < g.apps; i++) { add(`a${i}`, "APP"); link("l", `a${i}`); }

  const readTier = g.cache ? "k" : null;
  if (g.cache) add("k", "CACHE");
  for (let i = 0; i < g.replicas; i++) add(`r${i}`, "REPLICA");
  if (g.queue) { add("q", "QUEUE"); add("w", "WORKER"); link("q", "w"); link("w", "d"); }

  for (let i = 0; i < g.apps; i++) {
    const a = `a${i}`;
    if (readTier) link(a, readTier);
    for (let r = 0; r < g.replicas; r++) if (!g.cache) link(a, `r${r}`);
    if (g.queue) link(a, "q"); else link(a, "d");
    if (!readTier && g.replicas === 0) link(a, "d");
  }
  if (g.queue && !readTier) for (let i = 0; i < g.apps; i++) link(`a${i}`, "d");   // reads still need the primary
  if (g.cache) {
    for (let r = 0; r < g.replicas; r++) link("k", `r${r}`);
    link("k", "d");
  }
  for (let r = 0; r < g.replicas; r++) link("d", `r${r}`);

  // de-dupe (queue+cache designs can re-add the same edge)
  const seen = new Set<string>();
  const uniq = edges.filter((e) => { const k = e.from + ">" + e.to; if (seen.has(k)) return false; seen.add(k); return true; });
  return {
    nodes, edges: uniq,
    policy: { ...DEFAULT_POLICY, breaker: g.breaker, retries: g.retries, idempotentWrites: g.idempotent },
  };
}

export const designCost = (d: Design): number => d.nodes.reduce((s, n) => s + PARTS[n.part].cost, 0);
