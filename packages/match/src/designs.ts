import type { Design, DesignEdge, DesignNode, NodeId, PartId, Policy } from "@sysd/sim";
import { PARTS } from "@sysd/shared";
import { WORLD, type Layout } from "./types.js";

export const DEFAULT_POLICY: Policy = {
  readTimeoutMs: 250, writeTimeoutMs: 600, retries: 2, breaker: false,
  retryBudgetPct: 400, idempotentWrites: false,
};

export const designCost = (d: Design): number => d.nodes.reduce((s, n) => s + PARTS[n.part].cost, 0);

export function partCounts(d: Design): Partial<Record<PartId, number>> {
  const out: Partial<Record<PartId, number>> = {};
  for (const n of d.nodes) out[n.part] = (out[n.part] ?? 0) + 1;
  return out;
}

/** Tidy layout: depth from the visitors becomes a column; position within a column becomes a row. */
export function autoLayout(d: Design): Layout {
  const out = new Map<NodeId, NodeId[]>();
  const indeg = new Map<NodeId, number>();
  for (const n of d.nodes) { out.set(n.id, []); indeg.set(n.id, 0); }
  for (const e of d.edges) { out.get(e.from)?.push(e.to); indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1); }
  const depth = new Map<NodeId, number>();
  const client = d.nodes.find((n) => n.part === "CLIENT");
  const queue: NodeId[] = client ? [client.id] : [];
  if (client) depth.set(client.id, 0);
  while (queue.length) {
    const id = queue.shift() as NodeId;
    for (const t of out.get(id) ?? []) {
      const nd = (depth.get(id) ?? 0) + 1;
      if (!depth.has(t) || (depth.get(t) as number) < nd) {
        if (nd < d.nodes.length) { depth.set(t, nd); queue.push(t); }
      }
    }
  }
  let extra = 0;
  for (const n of [...d.nodes].sort((a, b) => (a.id < b.id ? -1 : 1))) if (!depth.has(n.id)) depth.set(n.id, 1 + (extra++ % 3));
  const cols = new Map<number, NodeId[]>();
  for (const n of [...d.nodes].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const c = depth.get(n.id) as number;
    const a = cols.get(c) ?? []; a.push(n.id); cols.set(c, a);
  }
  const maxCol = Math.max(0, ...cols.keys());
  const layout: Layout = {};
  const x0 = 90, x1 = WORLD.w - 90;
  for (const [c, ids] of cols) {
    const x = maxCol === 0 ? WORLD.w / 2 : x0 + ((x1 - x0) * c) / maxCol;
    ids.forEach((id, i) => {
      const y = ((i + 1) * WORLD.h) / (ids.length + 1);
      layout[id] = { x: Math.round(x / 4) * 4, y: Math.round(y / 4) * 4 };
    });
  }
  return layout;
}

/** The smallest design that works: visitors, one application server, one database. */
export function starterDesign(seat: 0 | 1): Design {
  const c = `n${seat}-1`, a = `n${seat}-2`, d = `n${seat}-3`;
  return {
    nodes: [{ id: c, part: "CLIENT" }, { id: a, part: "APP" }, { id: d, part: "DB" }],
    edges: [{ from: c, to: a }, { from: a, to: d }],
    policy: DEFAULT_POLICY,
  };
}

/* ------------------------------------------------------------ generated designs */

export interface Genome {
  apps: number; cache: boolean; cdn: boolean; replicas: number; queue: boolean; limiter: boolean;
  breaker: boolean; retries: number; idempotent: boolean;
}

export function* genomes(): Generator<Genome> {
  for (const apps of [1, 2, 3, 4])
    for (const cache of [false, true]) for (const cdn of [false, true])
      for (const replicas of [0, 1, 2]) for (const queue of [false, true]) for (const limiter of [false, true])
        for (const breaker of [false, true]) for (const retries of [0, 1, 2, 3]) for (const idempotent of [false, true])
          yield { apps, cache, cdn, replicas, queue, limiter, breaker, retries, idempotent };
}

/** Build a design from a genome. Ids are `n{seat}-{counter}` like the editor produces. */
export function buildGenome(g: Genome, seat: 0 | 1 = 0): Design {
  let counter = 0;
  const nid = (): NodeId => `n${seat}-${++counter}`;
  const nodes: DesignNode[] = [];
  const edges: DesignEdge[] = [];
  const add = (part: PartId): NodeId => { const id = nid(); nodes.push({ id, part }); return id; };
  const link = (from: NodeId, to: NodeId): void => { edges.push({ from, to }); };

  const c = add("CLIENT"), l = add("LB"), d = add("DB");
  const x = g.limiter ? add("RATELIMIT") : null;
  const n = g.cdn ? add("CDN") : null;
  const k = g.cache ? add("CACHE") : null;
  const apps = Array.from({ length: g.apps }, () => add("APP"));
  const reps = Array.from({ length: g.replicas }, () => add("REPLICA"));
  const q = g.queue ? add("QUEUE") : null;
  const w = g.queue ? add("WORKER") : null;

  const front = x ?? c;
  if (x) link(c, x);
  link(front, l);
  if (n) { link(front, n); link(n, l); }
  for (const a of apps) link(l, a);
  for (const a of apps) {
    if (k) link(a, k);
    if (!k) for (const r of reps) link(a, r);
    if (q) link(a, q); else link(a, d);
    if (!k && g.replicas === 0 && !q) { /* reads and writes both reach the database through the line above */ }
  }
  if (q && !k) for (const a of apps) link(a, d);
  if (q && w) { link(q, w); link(w, d); }
  if (k) { for (const r of reps) link(k, r); link(k, d); }
  for (const r of reps) link(d, r);

  const seen = new Set<string>();
  const uniq = edges.filter((e) => { const key = e.from + ">" + e.to; if (seen.has(key)) return false; seen.add(key); return true; });
  return {
    nodes, edges: uniq,
    policy: { ...DEFAULT_POLICY, breaker: g.breaker, retries: g.retries, idempotentWrites: g.idempotent },
  };
}

export function genomeNeeds(g: Genome): Partial<Record<PartId, number>> {
  const need: Partial<Record<PartId, number>> = { LB: 1, DB: 1, APP: g.apps };
  if (g.cache) need.CACHE = 1;
  if (g.cdn) need.CDN = 1;
  if (g.replicas) need.REPLICA = g.replicas;
  if (g.queue) { need.QUEUE = 1; need.WORKER = 1; }
  if (g.limiter) need.RATELIMIT = 1;
  return need;
}
