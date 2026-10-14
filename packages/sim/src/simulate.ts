import { clamp, q6, safeDiv } from "./math.js";
import { compile, type CEdge, type CNode, type Compiled } from "./compile.js";
import {
  flowAbove, flowBetween, merge, percentile, scaleTo, shift, total, type Buckets,
} from "./latency.js";
import type {
  ClassResult, Finding, Mods, NodeId, NodeResult, SimCarry, SimInput, SimOutput, SimResult,
} from "./types.js";

export const NO_MODS: Mods = {
  killed: [], spikeMul: 1, writeSpikeMul: 1, flush: false,
  latencyAddMs: {}, capMul: 1, shedFrac: 0, durationSec: 30,
};
export const NO_CARRY: SimCarry = { queueDepth: {} };

interface W {                       // per-node working state for one sweep
  inR: Buckets; inW: Buckets;
  botR: number;                     // bot reads/sec among inR (not visitors)
  demand: number;                   // capacity units routed here so far (cascade headroom)
  servedR: number; servedW: number; asyncDelivered: number;
  loadR: number; loadW: number;
  util: number; lat: number; dropped: number; kw: number;
}
interface Est {
  committed: Map<NodeId, number>;   // writes/sec committed per primary (prev iteration)
  asyncIn: Map<NodeId, number>;     // async-drained writes/sec arriving at each store
  mR: number; mW: number;           // retry load multipliers
}
interface Sweep {
  w: Map<NodeId, W>;
  termR: Buckets; termW: Buckets;
  entryR: number; entryW: number;
  queue: Map<NodeId, { arrivals: number; drain: number; delivered: number; depth: number; overflow: number }>;
  committed: Map<NodeId, number>;
  asyncIn: Map<NodeId, number>;
  lostWrites: number;
  workerLoad: Map<NodeId, number>;
  botAnswered: number;              // bot requests that got an answer (they are not visitors)
}

export function simulate(input: SimInput): SimOutput {
  const { design, ruleset, scenario, mods } = input;
  const C = ruleset.constants;
  const comp = compile(design, ruleset);
  if (!comp.ok || !comp.entry) return failed(comp, input);

  const baseR = scenario.rps * (1 - scenario.writeRatio) * mods.spikeMul * (1 - mods.shedFrac);
  const baseW = scenario.rps * scenario.writeRatio * mods.writeSpikeMul * (1 - mods.shedFrac);
  const pol = design.policy;
  // Bots add read load that is not visitors: they use capacity everywhere they reach, and are never counted as failed visitors.
  const botFlow = (mods.botRps ?? 0) * (1 - mods.shedFrac);

  let est: Est = { committed: new Map(), asyncIn: new Map(), mR: 1, mW: 1 };
  let sweep!: Sweep;
  let cls!: { r: Cls; w: Cls };

  for (let it = 0; it < C.maxIterations; it++) {
    sweep = runSweep(input, comp, est, baseR * est.mR, baseW * est.mW, botFlow);
    cls = {
      r: classify(sweep.termR, baseR, sweep.entryR, scenario.sloP99Ms, pol.readTimeoutMs, pol, C.breakerTrip, C.retryCorrelation),
      w: classify(sweep.termW, baseW, sweep.entryW, scenario.writeSloP99Ms, pol.writeTimeoutMs, pol, C.breakerTrip, C.retryCorrelation),
    };
    // Diminishing-step relaxation. Retries amplify load (positive feedback) while the breaker
    // suppresses it (negative feedback); a fixed step can flap between the two. Steps shrink
    // 1, 1/1.5, 1/2, ... so the iteration settles on the time-averaged fixed point.
    const lam = Math.max(0.03, 1 / (1 + it * 0.5));
    const next: Est = {
      committed: sweep.committed,
      asyncIn: sweep.asyncIn,
      mR: est.mR + lam * (cls.r.mTarget - est.mR),
      mW: est.mW + lam * (cls.w.mTarget - est.mW),
    };
    // residual is measured against the TARGET, not the step, so a tiny step cannot fake convergence
    const residual = Math.abs(cls.r.mTarget - est.mR) + Math.abs(cls.w.mTarget - est.mW)
      + (mapDelta(next.committed, est.committed) + mapDelta(next.asyncIn, est.asyncIn)) / (baseW + 1);
    est = next;
    if (it >= 2 && residual < C.tolerance) break;
  }

  const res = assemble(input, comp, sweep, cls, baseR, baseW, est);
  return { result: res.result, carry: res.carry };
}

function mapDelta(a: ReadonlyMap<NodeId, number>, b: ReadonlyMap<NodeId, number>): number {
  let d = 0;
  for (const [k, v] of a) d += Math.abs(v - (b.get(k) ?? 0));
  for (const [k, v] of b) if (!a.has(k)) d += Math.abs(v);
  return d;
}

/* ------------------------------------------------------------- one sweep */
function runSweep(input: SimInput, comp: Compiled, est: Est, entryR: number, entryW: number, botFlow: number): Sweep {
  const { ruleset, scenario, mods, carry } = input;
  const C = ruleset.constants;
  const dead = new Set(mods.killed);
  const w = new Map<NodeId, W>();
  for (const n of comp.nodes) {
    w.set(n.id, { inR: [], inW: [], botR: 0, demand: 0, servedR: 0, servedW: 0, asyncDelivered: 0,
      loadR: 0, loadW: 0, util: 0, lat: 0, dropped: 0, kw: 1 });
  }
  const sw: Sweep = {
    w, termR: [], termW: [], entryR, entryW, queue: new Map(),
    committed: new Map(), asyncIn: new Map(), lostWrites: 0, workerLoad: new Map(), botAnswered: 0,
  };
  const W_ = (id: NodeId): W => w.get(id) as W;
  const capOf = (n: CNode): number => n.def.capacity * mods.capMul * (mods.partCapMul?.[n.def.id] ?? 1);
  const alive = (id: NodeId): boolean => !dead.has(id);
  const T = scenario.roundSeconds;

  const entry = W_(comp.entry as NodeId);
  entry.inR = entryR + botFlow > 0 ? [{ lat: 0, flow: entryR + botFlow }] : [];
  entry.botR = botFlow;
  entry.inW = entryW > 0 ? [{ lat: 0, flow: entryW }] : [];

  // A flushed cache refills over cacheWarmupSec (linear ramp, avoiding exp(): transcendentals are
  // not pinned by IEEE-754). Average hit-rate factor over a window of T seconds:
  //   T <= tau : T / (2 tau)        T > tau : 1 - tau / (2 T)
  const tau = C.cacheWarmupSec * (mods.warmupMul ?? 1), Tw = Math.max(mods.durationSec, 1e-9);
  const warm = !mods.flush ? 1 : Tw <= tau ? Tw / (2 * tau) : 1 - tau / (2 * Tw);

  const estWriteTotal = (() => { let s = 0; for (const v of est.committed.values()) s += v; return s || entryW; })();

  const eligible = (e: CEdge, cls: "read" | "write"): boolean => {
    if (!e.carries[cls] || !alive(e.to)) return false;
    const t = comp.byId.get(e.to) as CNode;
    if (t.def.id === "REPLICA") return (comp.inbound.get(e.to) ?? []).some((x) => x.carries.repl);
    return true;
  };

  const push = (to: NodeId, cls: "read" | "write", b: Buckets, flow: number, bots = 0): void => {
    const t = W_(to), node = comp.byId.get(to) as CNode;
    if (cls === "read") { t.inR = merge(t.inR, scaleTo(b, flow), C.maxBuckets); t.demand += flow * node.def.readCost; t.botR += bots; }
    else { t.inW = merge(t.inW, scaleTo(b, flow), C.maxBuckets); t.demand += flow * node.def.writeCost; }
  };

  /** route `flow` of class `cls`, carried as histogram `b`, out of `from` */
  const route = (from: CNode, cls: "read" | "write", b: Buckets, flow: number, botFlow = 0): number => {
    if (!(flow > 0)) return 0;
    const edges = (comp.out.get(from.id) ?? []).filter((e) => e.carries[cls]);
    if (edges.length === 0) return flow;                      // leaf that cannot answer
    const elig = edges.filter((e) => eligible(e, cls));
    if (elig.length === 0) return flow;                       // every backend dead
    const kids = elig.map((e) => comp.byId.get(e.to) as CNode);
    const costOf = (k: CNode): number => (cls === "read" ? k.def.readCost : k.def.writeCost);

    if (from.def.routing === "balance") {
      const tot = kids.reduce((s, k) => s + capOf(k), 0);
      for (const k of kids) { const f = safeDiv(flow * capOf(k), tot); push(k.id, cls, b, f, safeDiv(botFlow * f, flow)); }
      return 0;
    }
    // cascade: fill the highest-priority tier up to spillUtil, spill the rest down
    const tiers = new Map<number, CNode[]>();
    for (const k of kids) { const a = tiers.get(k.def.tierPriority) ?? []; a.push(k); tiers.set(k.def.tierPriority, a); }
    const keys = [...tiers.keys()].sort((a, b2) => a - b2);
    let remaining = flow;
    keys.forEach((key, idx) => {
      if (!(remaining > 0)) return;
      const group = tiers.get(key) as CNode[];
      const last = idx === keys.length - 1;
      const head = group.map((k) => Math.max(0, capOf(k) * C.spillUtil - W_(k.id).demand) / costOf(k));
      const hsum = head.reduce((s, x) => s + x, 0);
      if (last) {
        const wts = hsum > 0 ? head : group.map((k) => capOf(k));
        const ws = wts.reduce((s, x) => s + x, 0);
        group.forEach((k, i) => { const f = safeDiv(remaining * (wts[i] as number), ws); push(k.id, cls, b, f, safeDiv(botFlow * f, flow)); });
        remaining = 0;
      } else {
        const take = Math.min(remaining, hsum);
        if (take > 0) group.forEach((k, i) => { const f = safeDiv(take * (head[i] as number), hsum); push(k.id, cls, b, f, safeDiv(botFlow * f, flow)); });
        remaining -= take;
      }
    });
    return 0;
  };

  for (const n of comp.nodes) {
    const s = W_(n.id), d = n.def;
    const fr = total(s.inR), fw = total(s.inW);
    s.loadR = fr; s.loadW = fw;
    if (d.id === "WORKER") continue;                          // driven by the queue step below
    if (!alive(n.id)) { s.dropped = fr + fw; continue; }

    // replication + async load on this node, from the previous sweep's estimate
    let replIn = 0, ship = 0;
    const asyncW = est.asyncIn.get(n.id) ?? 0;
    if (d.id === "REPLICA") {
      for (const e of comp.inbound.get(n.id) ?? []) if (e.carries.repl) replIn += est.committed.get(e.from) ?? 0;
    }
    if (d.id === "DB") {
      const nrep = (comp.repl.get(n.id) ?? []).filter((r) => alive(r)).length;
      ship = nrep * (est.committed.get(n.id) ?? 0) * d.shipCost;
    }

    const cap = capOf(n);
    const demand = fr * d.readCost + (fw + asyncW) * d.writeCost + replIn * d.replCost + ship;
    const util = safeDiv(demand, cap);
    s.util = util;

    let kr = 1, kw = 1;
    if (util > 1) {
      if (d.writePriority) {
        const wUnits = (fw + asyncW) * d.writeCost;
        kw = wUnits > 0 ? Math.min(1, cap / wUnits) : 1;
        const rem = Math.max(0, cap - wUnits * kw - replIn * d.replCost - ship);
        kr = fr * d.readCost > 0 ? clamp(rem / (fr * d.readCost), 0, 1) : 1;
      } else { kr = kw = cap / demand; }
    }
    s.kw = kw;
    s.servedR = fr * kr; s.servedW = fw * kw; s.asyncDelivered = asyncW * kw;
    s.dropped = (fr - s.servedR) + (fw - s.servedW);

    const u = Math.min(util, C.utilCap);
    const add = (mods.latencyAddMs[n.id] ?? 0) + (mods.latencyAddMs[d.id] ?? 0);
    s.lat = (d.baseLatencyMs + add) * Math.min(1 / (1 - u), C.latCapMul);

    let outR = shift(scaleTo(s.inR, s.servedR), s.lat);
    let outW = shift(scaleTo(s.inW, s.servedW), s.lat);
    let fwdR = s.servedR, fwdW = s.servedW;
    let botFwd = fr > 0 ? s.botR * (s.servedR / fr) : 0;       // bots that were served here, still travelling on
    const blocks = mods.botBlock?.[d.id];
    if (blocks && botFwd > 0) {                                 // a rate limiter that tells bots from people
      const removed = botFwd * blocks;
      botFwd -= removed; fwdR -= removed;
      outR = scaleTo(outR, fwdR);
    }

    if (d.shedRate !== undefined) {                           // limiter drops real users
      s.dropped += (fwdR + fwdW) * d.shedRate;
      fwdR *= 1 - d.shedRate; fwdW *= 1 - d.shedRate; botFwd *= 1 - d.shedRate;
      outR = scaleTo(outR, fwdR); outW = scaleTo(outW, fwdW);
    }

    const visitorR = (): Buckets => scaleTo(outR, Math.max(0, fwdR - botFwd));    // answers that belong to real visitors
    if (d.id === "DB") {
      sw.botAnswered += botFwd;
      sw.termR = merge(sw.termR, visitorR(), C.maxBuckets);
      sw.termW = merge(sw.termW, outW, C.maxBuckets);
      sw.committed.set(n.id, s.servedW + s.asyncDelivered);
      continue;
    }
    if (d.id === "REPLICA") {
      sw.botAnswered += botFwd;
      sw.termR = merge(sw.termR, visitorR(), C.maxBuckets);
      continue;
    }
    if (d.id === "QUEUE") {
      sw.termW = merge(sw.termW, outW, C.maxBuckets);         // client is acked here
      sw.queue.set(n.id, { arrivals: s.servedW, drain: 0, delivered: 0, depth: 0, overflow: 0 });
      continue;
    }
    if (d.hitRate !== undefined) {                            // CACHE / CDN, reads only
      const wShare = safeDiv(estWriteTotal, estWriteTotal + fr);
      const erosion = Math.min(C.invalCap, wShare * (d.invalidationSensitivity ?? 0));
      let effHit = d.hitRate * (1 - erosion) * warm;
      if (mods.hitBoost) effHit = Math.min(0.97, effHit * (1 + mods.hitBoost));          // the same few links, over and over
      if (mods.uniqueReadFrac) effHit *= 1 - mods.uniqueReadFrac;                          // links nobody asked for before
      const hit = fwdR * effHit;
      const botHit = fwdR > 0 ? botFwd * (hit / fwdR) : 0;
      sw.botAnswered += botHit;
      sw.termR = merge(sw.termR, scaleTo(outR, hit - botHit), C.maxBuckets);
      fwdR -= hit; botFwd -= botHit; outR = scaleTo(outR, fwdR);
    }
    s.dropped += route(n, "read", outR, fwdR, botFwd);
    s.dropped += route(n, "write", outW, fwdW);
  }

  // async path: queue -> workers -> stores, with carried backlog
  for (const n of comp.nodes) {
    if (n.def.id !== "QUEUE") continue;
    const q = sw.queue.get(n.id);
    if (!q) continue;
    const workers = (comp.drains.get(n.id) ?? []).filter(alive).map((id) => comp.byId.get(id) as CNode);
    const depth0 = carry.queueDepth[n.id] ?? 0;
    const workerCap = workers.reduce((a, k) => a + capOf(k) / k.def.writeCost, 0);
    const avail = q.arrivals + depth0 / T;
    const drain = Math.min(avail, workerCap);
    const wCapSum = workers.reduce((a, k) => a + capOf(k), 0);
    let delivered = 0;
    for (const k of workers) {
      const share = safeDiv(drain * capOf(k), wCapSum);
      const ws = W_(k.id);
      ws.loadW = share; ws.util = safeDiv(share * k.def.writeCost, capOf(k)); ws.servedW = share;
      ws.lat = k.def.baseLatencyMs * Math.min(1 / (1 - Math.min(ws.util, C.utilCap)), C.latCapMul);
      const stores = (comp.out.get(k.id) ?? [])
        .filter((e) => e.carries.write && alive(e.to) && (comp.byId.get(e.to) as CNode).def.id === "DB")
        .map((e) => comp.byId.get(e.to) as CNode);
      const sc = stores.reduce((a, x) => a + capOf(x), 0);
      for (const st of stores) {
        const part = safeDiv(share * capOf(st), sc);
        sw.asyncIn.set(st.id, (sw.asyncIn.get(st.id) ?? 0) + part);
        delivered += part * W_(st.id).kw;
      }
    }
    const maxDepth = n.def.queueMaxDepth ?? 0;
    let depth = Math.max(0, depth0 + (q.arrivals - delivered) * T);
    let overflow = 0;
    if (depth > maxDepth) { overflow = depth - maxDepth; depth = maxDepth; }
    q.drain = drain; q.delivered = delivered; q.depth = depth; q.overflow = overflow;
    sw.lostWrites += overflow / T;
  }
  return sw;
}

/* ------------------------------------------------- per-class accounting */
interface Cls {
  attempts: number; dropped: number; p50: number; p99: number;
  fast: number; slow: number; timedOut: number;
  attemptFail: number; userFail: number; slowFrac: number; badFrac: number;
  mTarget: number; tripped: boolean; timedOutFrac: number;
}

function classify(
  term: Buckets, base: number, entry: number, slo: number, timeout: number,
  pol: SimInput["design"]["policy"], breakerTrip: number, rho: number,
): Cls {
  const answered = total(term);
  const dropped = Math.max(0, entry - answered);
  const timedOut = flowAbove(term, timeout);
  const slow = flowBetween(term, slo, timeout);
  const fast = Math.max(0, answered - timedOut - slow);
  const p = clamp(safeDiv(dropped + timedOut, entry), 0, 1);

  // Circuit breaker: a smooth ramp, not a cliff. Retry suppression s rises 0 -> 1 as the attempt
  // failure rate climbs from breakerTrip/2 to breakerTrip. (A hard threshold made a HARDER attack
  // able to flip the breaker open and do LESS damage -- a perverse incentive.)
  const lo = breakerTrip / 2;
  const s = pol.breaker ? clamp((p - lo) / (breakerTrip - lo), 0, 1) : 0;
  const tripped = s >= 0.5;
  const R = pol.retries;
  // A retry of a failed request is likelier to fail again than a fresh one:
  // q = P(attempt k+1 fails | attempt k failed). Attempt k happens w.p. p*q^(k-1).
  const q = rho + (1 - rho) * p;
  let geom = 1, t = p;                                        // geom = sum of attempt probabilities
  for (let k = 1; k <= R; k++) { geom += t; t *= q; }
  const mCap = 1 + pol.retryBudgetPct / 100;
  const mTarget = 1 + (Math.min(geom, mCap) - 1) * (1 - s);   // breaker damps retry load
  const userFull = t;                                         // p * q^R : every attempt failed
  const frac = geom > 1 ? clamp((mTarget - 1) / (geom - 1), 0, 1) : 0;
  const userFail = clamp(p + (userFull - p) * frac, 0, 1);    // blend: no retries .. full retries

  // Unified badness: a request is bad iff it was dropped OR did not finish within the SLO.
  // A retried request cannot finish within the SLO (timeout >= SLO), so retries rescue
  // AVAILABILITY (userFail) but never LATENCY. Counting slow and timed-out requests the same
  // way also removes a non-monotonicity: more load can no longer "improve" the score by
  // converting slow requests (counted bad) into retried ones (counted partly good).
  const badFrac = clamp(Math.max(1 - safeDiv(fast, entry), userFail), 0, 1);
  const slowFrac = userFail < 1 ? clamp((badFrac - userFail) / (1 - userFail), 0, 1) : 0;
  void base;
  return {
    attempts: entry, dropped, p50: percentile(term, 0.5), p99: percentile(term, 0.99),
    fast, slow, timedOut, attemptFail: p, userFail, slowFrac, badFrac,
    mTarget, tripped, timedOutFrac: safeDiv(timedOut, entry),
  };
}

/* ------------------------------------------------------------- assembly */
function assemble(
  input: SimInput, comp: Compiled, sw: Sweep,
  cls: { r: Cls; w: Cls }, baseR: number, baseW: number, est: Est,
): { result: SimResult; carry: SimCarry } {
  const { ruleset, scenario, mods, design } = input;
  const C = ruleset.constants;
  const dead = new Set(mods.killed);
  const nodes: NodeResult[] = [];
  let replicaReadRps = 0, stalenessMs = 0;
  const findings: Finding[] = [];

  for (const n of comp.nodes) {
    const s = sw.w.get(n.id) as W;
    nodes.push({
      id: n.id, part: n.def.id, dead: dead.has(n.id),
      loadR: q6(s.loadR), loadW: q6(s.loadW), util: q6(s.util), latMs: q6(s.lat), dropped: q6(s.dropped),
    });
    if (n.def.id === "REPLICA" && !dead.has(n.id)) {
      replicaReadRps += s.servedR;
      const lag = (n.def.replicaLagBaseMs ?? 0) * Math.min(1 / (1 - Math.min(s.util, C.utilCap)), C.replLagCapMul);
      stalenessMs = Math.max(stalenessMs, lag);
    }
    if (dead.has(n.id) && n.def.id !== "CLIENT") findings.push({ code: "dead-node", severity: "bad", nodeId: n.id });
    else if (s.util > 1) findings.push({ code: "saturated-node", severity: "bad", nodeId: n.id, value: q6(s.util) });
  }

  const nextDepth: Record<string, number> = {};
  let queueDepth = 0, queueDelayMs = 0, lostWrites = sw.lostWrites;
  for (const [id, q] of sw.queue) {
    nextDepth[id] = q6(q.depth);
    queueDepth += q.depth;
    queueDelayMs = Math.max(queueDelayMs, safeDiv(q.depth, Math.max(q.drain, 1e-9)) * 1000);
    if (q.overflow > 0) findings.push({ code: "queue-overflow", severity: "bad", nodeId: id, value: q6(q.overflow) });
  }
  stalenessMs = Math.max(stalenessMs, Math.min(queueDelayMs, 600000));

  const extraW = baseW * (est.mW - 1);
  const wDen = cls.w.dropped + cls.w.timedOut;
  const duplicateWrites = design.policy.idempotentWrites ? 0 : extraW * safeDiv(cls.w.timedOut, wDen);
  if (duplicateWrites > 0.5) findings.push({ code: "duplicate-writes", severity: "warn", value: q6(duplicateWrites) });

  if (est.mR > 1.05 || est.mW > 1.05)
    findings.push({ code: "retry-storm", severity: "bad", value: q6(Math.max(est.mR, est.mW)) });
  const tripped = cls.r.tripped || cls.w.tripped;
  if (tripped) findings.push({ code: "breaker-tripped", severity: "info" });
  if (mods.flush) {
    const origin = comp.nodes.filter((n) => n.def.tag === "store").reduce((a, n) => a + n.def.capacity, 0);
    if (origin < baseR * 0.5) findings.push({ code: "thundering-herd", severity: "bad", value: q6(origin) });
  }
  if (cls.r.p99 > scenario.sloP99Ms) findings.push({ code: "slo-breach", severity: "warn", value: q6(cls.r.p99) });
  if (stalenessMs > scenario.consistencySloMs) findings.push({ code: "stale-reads", severity: "warn", value: q6(stalenessMs) });
  if (comp.nodes.some((n) => n.def.id === "RATELIMIT") && (cls.r.dropped + cls.w.dropped) > 0)
    findings.push({ code: "limiter-drops-users", severity: "warn" });

  const toClass = (c: Cls, base: number, m: number): ClassResult => ({
    offered: q6(base), attempts: q6(c.attempts), dropped: q6(c.dropped),
    attemptFail: q6(c.attemptFail), userFail: q6(c.userFail), slowFrac: q6(c.slowFrac), badFrac: q6(c.badFrac),
    p50Ms: q6(c.p50), p99Ms: q6(c.p99), amplification: q6(m), timedOutFrac: q6(c.timedOutFrac),
  });

  nodes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  findings.sort((a, b) => (a.code + (a.nodeId ?? "")) < (b.code + (b.nodeId ?? "")) ? -1 : 1);

  return {
    result: {
      read: toClass(cls.r, baseR, est.mR), write: toClass(cls.w, baseW, est.mW),
      consistency: {
        stalenessMs: q6(stalenessMs), lostWrites: q6(lostWrites), duplicateWrites: q6(duplicateWrites),
        queueDepth: q6(queueDepth), replicaReadRps: q6(replicaReadRps),
      },
      nodes, findings, breakerTripped: tripped,
    },
    carry: { queueDepth: nextDepth },
  };
}

/** An invalid design fails everything rather than throwing: callers get a result to render. */
function failed(comp: Compiled, input: SimInput): SimOutput {
  const base = input.scenario.rps;
  const dead: ClassResult = {
    offered: q6(base), attempts: q6(base), dropped: q6(base), attemptFail: 1, userFail: 1,
    slowFrac: 0, badFrac: 1, p50Ms: 0, p99Ms: 0, amplification: 1, timedOutFrac: 0,
  };
  void comp;
  return {
    result: {
      read: dead, write: dead,
      consistency: { stalenessMs: 0, lostWrites: 0, duplicateWrites: 0, queueDepth: 0, replicaReadRps: 0 },
      nodes: [], findings: [], breakerTripped: false,
    },
    carry: input.carry,
  };
}
