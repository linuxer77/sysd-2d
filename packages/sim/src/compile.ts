import type {
  ClassSet, Design, DesignEdge, DesignNode, Issue, NodeId, PartDef, Ruleset, TrafficClass,
} from "./types.js";

const ID_RE = /^[a-z][a-z0-9_-]{0,31}$/;
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export interface CNode {
  readonly id: NodeId;
  readonly node: DesignNode;
  readonly def: PartDef;
  /** index in canonical topological order */
  readonly rank: number;
}
export interface CEdge {
  readonly from: NodeId;
  readonly to: NodeId;
  readonly carries: ClassSet;
}
export interface Compiled {
  readonly nodes: readonly CNode[];           // topological order, ties by id
  readonly byId: ReadonlyMap<NodeId, CNode>;
  readonly entry: NodeId | null;
  /** sync out-edges: every non-repl edge not leaving a QUEUE */
  readonly out: ReadonlyMap<NodeId, readonly CEdge[]>;
  readonly inbound: ReadonlyMap<NodeId, readonly CEdge[]>;
  /** DB -> REPLICA replication edges */
  readonly repl: ReadonlyMap<NodeId, readonly NodeId[]>;
  /** QUEUE -> WORKER async edges */
  readonly drains: ReadonlyMap<NodeId, readonly NodeId[]>;
  readonly issues: readonly Issue[];
  readonly ok: boolean;
}

const none: ClassSet = { read: false, write: false, repl: false };
const meet = (a: ClassSet, b: ClassSet): ClassSet => ({
  read: a.read && b.read, write: a.write && b.write, repl: a.repl && b.repl,
});
const any = (s: ClassSet): boolean => s.read || s.write || s.repl;
export const carriesClass = (e: { carries: ClassSet }, c: TrafficClass): boolean => e.carries[c];

/**
 * Validate + canonicalise + type edges + topologically sort.
 * Pure: no input mutation. Node/edge input order never affects the result.
 */
export function compile(design: Design, ruleset: Ruleset): Compiled {
  const issues: Issue[] = [];
  const err = (code: string, message: string, nodeId?: NodeId): void => {
    issues.push(nodeId === undefined ? { severity: "error", code, message } : { severity: "error", code, message, nodeId });
  };
  const warn = (code: string, message: string, nodeId?: NodeId): void => {
    issues.push(nodeId === undefined ? { severity: "warn", code, message } : { severity: "warn", code, message, nodeId });
  };

  const nodes = [...design.nodes].sort((a, b) => cmp(a.id, b.id));
  const defs = new Map<NodeId, PartDef>();
  for (const n of nodes) {
    if (!ID_RE.test(n.id)) err("bad-id", `node id "${n.id}" is not a valid id`, n.id);
    if (defs.has(n.id)) { err("dup-id", `duplicate node id "${n.id}"`, n.id); continue; }
    const def = ruleset.parts[n.part];
    if (!def) { err("bad-part", `unknown part "${String(n.part)}"`, n.id); continue; }
    defs.set(n.id, def);
  }

  const clients = nodes.filter((n) => n.part === "CLIENT");
  if (clients.length !== 1) err("client-count", `a design needs exactly one CLIENT (found ${clients.length})`);

  // edges: canonicalise, drop self/dup/dangling with errors
  const seen = new Set<string>();
  const edges: { e: DesignEdge; carries: ClassSet }[] = [];
  const sortedEdges = [...design.edges].sort((a, b) => cmp(a.from, b.from) || cmp(a.to, b.to));
  for (const e of sortedEdges) {
    const fd = defs.get(e.from), td = defs.get(e.to);
    if (!fd || !td) { err("dangling-edge", `edge ${e.from} -> ${e.to} references a missing node`); continue; }
    if (e.from === e.to) { err("self-edge", `node ${e.from} links to itself`, e.from); continue; }
    const key = e.from + ">" + e.to;
    if (seen.has(key)) { err("dup-edge", `duplicate edge ${e.from} -> ${e.to}`); continue; }
    seen.add(key);
    let carries = meet(fd.emits, td.accepts);
    if (e.pin === "read") carries = { read: carries.read, write: false, repl: false };
    if (e.pin === "write") carries = { read: false, write: carries.write, repl: false };
    if (!any(carries)) warn("dead-link", `${fd.id} cannot send anything ${td.id} accepts`, e.from);
    edges.push({ e, carries: any(carries) ? carries : none });
  }

  // adjacency (sync graph = everything but repl edges and queue out-edges)
  const out = new Map<NodeId, CEdge[]>();
  const inbound = new Map<NodeId, CEdge[]>();
  const repl = new Map<NodeId, NodeId[]>();
  const drains = new Map<NodeId, NodeId[]>();
  for (const n of nodes) { out.set(n.id, []); inbound.set(n.id, []); repl.set(n.id, []); drains.set(n.id, []); }
  const syncAdj = new Map<NodeId, NodeId[]>();
  for (const n of nodes) syncAdj.set(n.id, []);

  for (const { e, carries } of edges) {
    const fromPart = defs.get(e.from)!.id;
    const ce: CEdge = { from: e.from, to: e.to, carries };
    if (carries.repl) { repl.get(e.from)!.push(e.to); inbound.get(e.to)!.push(ce); continue; }
    if (fromPart === "QUEUE") { if (carries.write) drains.get(e.from)!.push(e.to); continue; }
    if (!any(carries)) continue;
    out.get(e.from)!.push(ce);
    inbound.get(e.to)!.push(ce);
    syncAdj.get(e.from)!.push(e.to);
  }

  // Kahn topological sort, ties broken by id => canonical order
  const indeg = new Map<NodeId, number>();
  for (const n of nodes) indeg.set(n.id, 0);
  for (const [, tos] of syncAdj) for (const t of tos) indeg.set(t, (indeg.get(t) ?? 0) + 1);
  const ready = nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id).sort(cmp);
  const order: NodeId[] = [];
  while (ready.length) {
    const id = ready.shift()!;
    order.push(id);
    for (const t of syncAdj.get(id) ?? []) {
      const d = (indeg.get(t) ?? 0) - 1;
      indeg.set(t, d);
      if (d === 0) { ready.push(t); ready.sort(cmp); }
    }
  }
  if (order.length !== nodes.length) err("cycle", "the design contains a request cycle");

  const cnodes: CNode[] = [];
  const byId = new Map<NodeId, CNode>();
  const placed = order.length === nodes.length ? order : nodes.map((n) => n.id);
  placed.forEach((id, rank) => {
    const node = nodes.find((n) => n.id === id)!;
    const def = defs.get(id);
    if (!def) return;
    const cn: CNode = { id, node, def, rank };
    cnodes.push(cn); byId.set(id, cn);
  });

  // reachability from CLIENT
  const client = clients[0];
  if (client && order.length === nodes.length) {
    const reach = new Set<NodeId>([client.id]);
    for (const id of order) if (reach.has(id)) for (const e of out.get(id) ?? []) reach.add(e.to);
    for (const n of nodes) {
      if (!reach.has(n.id) && n.part !== "WORKER" && n.part !== "REPLICA")
        warn("unreachable", `${n.part} is not reachable from the client`, n.id);
    }
  }

  // soft structural warnings
  for (const n of nodes) {
    if (n.part === "REPLICA" && !(inbound.get(n.id) ?? []).some((e) => e.carries.repl))
      warn("replica-no-primary", "a replica needs a DB feeding it over a replication link", n.id);
    if (n.part === "QUEUE" && (drains.get(n.id) ?? []).length === 0)
      warn("queue-no-worker", "a queue with no worker never drains", n.id);
    if ((n.part === "CACHE" || n.part === "CDN") && !(out.get(n.id) ?? []).some((e) => e.carries.read))
      warn("cache-no-origin", "a cache with no origin behind it fails every miss", n.id);
    if (n.part === "WORKER" && !nodes.some((q) => q.part === "QUEUE" && (drains.get(q.id) ?? []).includes(n.id)))
      warn("worker-no-queue", "a worker only runs when a queue feeds it", n.id);
  }

  const p = design.policy;
  if (!(p.readTimeoutMs >= 20 && p.readTimeoutMs <= 5000)) err("bad-policy", "readTimeoutMs out of range 20-5000");
  if (!(p.writeTimeoutMs >= 20 && p.writeTimeoutMs <= 10000)) err("bad-policy", "writeTimeoutMs out of range 20-10000");
  if (!(Number.isInteger(p.retries) && p.retries >= 0 && p.retries <= 4)) err("bad-policy", "retries must be an integer 0-4");
  if (!(p.retryBudgetPct >= 0 && p.retryBudgetPct <= 400)) err("bad-policy", "retryBudgetPct out of range 0-400");

  const frozenOut = new Map<NodeId, readonly CEdge[]>(), frozenIn = new Map<NodeId, readonly CEdge[]>();
  for (const [k, v] of out) frozenOut.set(k, v);
  for (const [k, v] of inbound) frozenIn.set(k, v);

  return {
    nodes: cnodes, byId, entry: client ? client.id : null,
    out: frozenOut, inbound: frozenIn, repl, drains, issues,
    ok: !issues.some((i) => i.severity === "error"),
  };
}

/** Lightweight validation for the editor and server lock-in checks. */
export function validate(design: Design, ruleset: Ruleset, limits?: { budget?: number; maxNodes?: number }): readonly Issue[] {
  const c = compile(design, ruleset);
  const issues = [...c.issues];
  if (limits?.maxNodes !== undefined && design.nodes.length > limits.maxNodes)
    issues.push({ severity: "error", code: "too-many-nodes", message: `max ${limits.maxNodes} nodes` });
  if (limits?.budget !== undefined) {
    const spent = design.nodes.reduce((s, n) => s + (ruleset.parts[n.part]?.cost ?? 0), 0);
    if (spent > limits.budget) issues.push({ severity: "error", code: "over-budget", message: `$${spent} exceeds the $${limits.budget} budget` });
  }
  return issues;
}
