import type { Design, Policy } from "@sysd/sim";
import type { PartId } from "@sysd/sim";

export const DEFAULT_POLICY: Policy = {
  readTimeoutMs: 250, writeTimeoutMs: 600, retries: 2, breaker: false,
  retryBudgetPct: 400, idempotentWrites: false,
};

type Spec = { nodes: [string, PartId][]; edges: [string, string][]; policy?: Partial<Policy> };

export function design(spec: Spec): Design {
  return {
    nodes: spec.nodes.map(([id, part]) => ({ id, part })),
    edges: spec.edges.map(([from, to]) => ({ from, to })),
    policy: { ...DEFAULT_POLICY, ...(spec.policy ?? {}) },
  };
}

/** Archetypes the balance harness and golden tests share. Costs are catalog costs. */
export const ARCHETYPES: Record<string, Design> = {
  // $230 — a client, an app, a database
  naive: design({
    nodes: [["c", "CLIENT"], ["a", "APP"], ["d", "DB"]],
    edges: [["c", "a"], ["a", "d"]],
  }),
  // $520 — lb, 3 apps, cache in front of one db
  cached: design({
    nodes: [["c", "CLIENT"], ["l", "LB"], ["a1", "APP"], ["a2", "APP"], ["a3", "APP"], ["k", "CACHE"], ["d", "DB"]],
    edges: [["c", "l"], ["l", "a1"], ["l", "a2"], ["l", "a3"],
            ["a1", "k"], ["a2", "k"], ["a3", "k"], ["a1", "d"], ["a2", "d"], ["a3", "d"], ["k", "d"]],
  }),
  // $640 — cache -> 2 replicas -> primary
  replicated: design({
    nodes: [["c", "CLIENT"], ["l", "LB"], ["a1", "APP"], ["a2", "APP"], ["k", "CACHE"],
            ["r1", "REPLICA"], ["r2", "REPLICA"], ["d", "DB"]],
    edges: [["c", "l"], ["l", "a1"], ["l", "a2"], ["a1", "k"], ["a2", "k"], ["a1", "d"], ["a2", "d"],
            ["k", "r1"], ["k", "r2"], ["k", "d"], ["d", "r1"], ["d", "r2"]],
  }),
  // $650 — async write path through a queue and worker
  queued: design({
    nodes: [["c", "CLIENT"], ["l", "LB"], ["a1", "APP"], ["a2", "APP"], ["k", "CACHE"],
            ["q", "QUEUE"], ["w", "WORKER"], ["d", "DB"]],
    edges: [["c", "l"], ["l", "a1"], ["l", "a2"], ["a1", "k"], ["a2", "k"], ["a1", "q"], ["a2", "q"],
            ["k", "d"], ["q", "w"], ["w", "d"]],
  }),
  // $610 — CDN then cache then db: two layers absorb reads before the origin
  layered: design({
    nodes: [["c", "CLIENT"], ["n", "CDN"], ["l", "LB"], ["a1", "APP"], ["a2", "APP"], ["a3", "APP"], ["k", "CACHE"], ["d", "DB"]],
    edges: [["c", "n"], ["c", "l"], ["n", "l"], ["l", "a1"], ["l", "a2"], ["l", "a3"],
            ["a1", "k"], ["a2", "k"], ["a3", "k"], ["a1", "d"], ["a2", "d"], ["a3", "d"], ["k", "d"]],
    policy: { breaker: true, retries: 1, idempotentWrites: true },
  }),
  // cached + breaker + tight retries: the cheap resilience
  hardened: design({
    nodes: [["c", "CLIENT"], ["l", "LB"], ["a1", "APP"], ["a2", "APP"], ["a3", "APP"], ["k", "CACHE"], ["d", "DB"]],
    edges: [["c", "l"], ["l", "a1"], ["l", "a2"], ["l", "a3"],
            ["a1", "k"], ["a2", "k"], ["a3", "k"], ["a1", "d"], ["a2", "d"], ["a3", "d"], ["k", "d"]],
    policy: { breaker: true, retries: 1, idempotentWrites: true },
  }),
  // the trap: a limiter "for protection"
  limiterTrap: design({
    nodes: [["c", "CLIENT"], ["x", "RATELIMIT"], ["l", "LB"], ["a1", "APP"], ["a2", "APP"], ["k", "CACHE"], ["d", "DB"]],
    edges: [["c", "x"], ["x", "l"], ["l", "a1"], ["l", "a2"], ["a1", "k"], ["a2", "k"], ["a1", "d"], ["a2", "d"], ["k", "d"]],
  }),
  // the rival from the prototype: one db, 3 retries, no breaker
  rival: design({
    nodes: [["c", "CLIENT"], ["l", "LB"], ["a1", "APP"], ["a2", "APP"], ["a3", "APP"], ["k", "CACHE"], ["d", "DB"]],
    edges: [["c", "l"], ["l", "a1"], ["l", "a2"], ["l", "a3"],
            ["a1", "k"], ["a2", "k"], ["a3", "k"], ["a1", "d"], ["a2", "d"], ["a3", "d"], ["k", "d"]],
    policy: { readTimeoutMs: 300, retries: 3 },
  }),
};

export const cost = (d: Design, parts: Record<string, { cost: number }>): number =>
  d.nodes.reduce((s, n) => s + (parts[n.part]?.cost ?? 0), 0);
