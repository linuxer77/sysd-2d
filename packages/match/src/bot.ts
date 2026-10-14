import { NO_CARRY, compile, damage, simulate, type Design, type NodeId, type Rng } from "@sysd/sim";
import { LINKSMASH, RULESET, applyAttack, baseMods, type AttackId } from "@sysd/shared";
import { bundleParts } from "./draft.js";
import { autoLayout, buildGenome, designCost, genomeNeeds, genomes, starterDesign, type Genome } from "./designs.js";
import { CATEGORY_OF, type Category, type Intent, type Layout, type OpId } from "./types.js";
import type { PlayerView } from "./view.js";

export type BotTier = "easy" | "normal" | "hard";
export interface BotMemo { design?: Design; layout?: Layout; updated?: boolean }

const PART_VALUE: Record<string, number> = { CDN: 5, REPLICA: 4, CACHE: 4, APP: 3, QUEUE: 2.5, LB: 1.5, WORKER: 1, RATELIMIT: 0.1, DB: 0, CLIENT: 0 };
const SAMPLE = { easy: 6, normal: 20, hard: 48 } as const;

/** Pick the strongest affordable, licensed design out of a sample, judged with the real simulator. */
export function chooseDesign(view: PlayerView, rng: Rng, tier: BotTier): Design {
  const lic = view.self.licences as Record<string, number>;
  const budget = LINKSMASH.budget;
  const feasible: Genome[] = [];
  for (const g of genomes()) {
    const need = genomeNeeds(g) as Record<string, number>;
    if (Object.entries(need).some(([p, n]) => (lic[p] ?? 0) < n)) continue;
    if (designCost(buildGenome(g, view.seat)) > budget) continue;
    feasible.push(g);
  }
  if (!feasible.length) return starterDesign(view.seat);
  const picks: Genome[] = [];
  const pool = [...feasible];
  for (let i = 0; i < Math.min(SAMPLE[tier], pool.length); i++) picks.push(pool.splice(rng.int(pool.length), 1)[0] as Genome);

  const score = (d: Design): number => {
    if (!compile(d, RULESET).ok) return Infinity;
    const db = d.nodes.find((n) => n.part === "DB")?.id;
    const attacks: { a: AttackId[]; t?: NodeId }[] = [{ a: [] }, { a: ["SPIKE"] }, { a: ["FLUSH", "SPIKE"] }, { a: ["WRITE_STORM"] }, ...(db ? [{ a: ["KILL" as AttackId], t: db }] : [])];
    let sum = 0;
    for (const x of attacks) {
      let m = baseMods(LINKSMASH.roundSeconds);
      for (const id of x.a) m = applyAttack(m, id, x.t);
      const r = simulate({ design: d, ruleset: RULESET, scenario: LINKSMASH, mods: m, carry: NO_CARRY }).result;
      sum += damage(r, LINKSMASH, RULESET, m.durationSec).total;
    }
    return sum + designCost(d) / 1000;      // cheaper breaks ties
  };
  let best = buildGenome(picks[0] as Genome, view.seat), bestScore = score(best);
  for (const g of picks.slice(1)) { const d = buildGenome(g, view.seat), sc = score(d); if (sc < bestScore) { best = d; bestScore = sc; } }
  return best;
}

const bundleScore = (id: string): number => bundleParts(id).reduce((s, p) => s + (PART_VALUE[p] ?? 0), 0);

/**
 * The bot sees exactly what a human sees (a PlayerView), so it plays fair. Returns the next thing it
 * wants to do, or null if it is waiting on something. Call again after every change.
 */
export function botStep(view: PlayerView, rng: Rng, tier: BotTier, memo: BotMemo): Intent | null {
  switch (view.phase) {
    case "lobby": return view.self.ready ? null : { k: "ready" };
    case "brief": return view.self.briefDone ? null : { k: "brief.done" };
    case "draft": {
      if (!view.draft || view.draft.stage !== "choose" || !view.draft.yourPick || !view.draft.pair) return null;
      const { a, b } = view.draft.pair;
      const sa = bundleScore(a.id), sb = bundleScore(b.id);
      const noisy = tier === "easy" ? rng.next() < 0.4 : false;
      const choice = noisy ? (rng.next() < 0.5 ? "a" : "b") : sa >= sb ? "a" : "b";
      return { k: "draft.pick", pair: view.draft.index, choice };
    }
    case "build": {
      if (view.self.locked) return null;
      if (!memo.design) { memo.design = chooseDesign(view, rng, tier); memo.layout = autoLayout(memo.design); }
      if (!memo.updated) { memo.updated = true; return { k: "build.update", design: memo.design, layout: memo.layout as Layout }; }
      return { k: "build.lock" };
    }
    case "recon": {
      if (view.self.reconDone) return null;
      const rival = view.rival.design;
      if (rival && tier !== "easy" && !view.self.revealedPolicy && view.self.probesLeft >= 2) return { k: "recon.probe", target: { kind: "policy" } };
      const unknown = (rival?.nodes ?? []).filter((n) => n.part === "UNKNOWN" && !view.self.revealedParts.includes(n.id));
      if (view.self.probesLeft >= 1 && unknown.length) return { k: "recon.probe", target: { kind: "part", nodeId: (unknown[rng.int(unknown.length)] as { id: NodeId }).id } };
      return { k: "recon.done" };
    }
    case "siege": {
      if (view.step === "declare" && !view.self.declared) return declare(view, rng, tier);
      if (view.step === "respond" && !view.self.response) return respond(view, tier);
      return null;
    }
    default: return null;
  }
}

function declare(view: PlayerView, rng: Rng, tier: BotTier): Intent {
  const uses = view.self.attackUses;
  const available = (Object.keys(uses) as AttackId[]).filter((a) => uses[a] > 0);
  if (!available.length) return { k: "siege.declare", attack: null, telegraph: null };
  const rival = view.rival.design;
  const parts = new Set((rival?.nodes ?? []).map((n) => n.part));
  const flushed = view.rival.effects.some((e) => e.kind === "flush");
  const last = view.rounds[view.rounds.length - 1];
  const weight: Record<AttackId, number> = { SPIKE: 3, FLUSH: 2, KILL: 2, LAG: 1.5, WRITE_STORM: 1.5 };
  if (flushed) weight.SPIKE += 4;                                       // the combo
  if (parts.has("CACHE") || parts.has("CDN")) weight.FLUSH += 2;
  if (parts.has("QUEUE")) weight.WRITE_STORM += 2;
  if (parts.has("REPLICA")) weight.LAG += 1;
  if (last) {                                                            // keep hitting what worked
    const prev = last.seats[view.seat === 0 ? 1 : 0].damageTaken;
    const used = last.seats[view.seat].attack?.id;
    if (used && prev >= 12) weight[used] += 3;
  }
  let chosen: AttackId;
  if (tier === "easy") chosen = available[rng.int(available.length)] as AttackId;
  else chosen = [...available].sort((a, b) => weight[b] - weight[a] || (a < b ? -1 : 1))[0] as AttackId;

  let target: NodeId | undefined;
  if (chosen === "KILL") {
    const nodes = (rival?.nodes ?? []).filter((n) => n.part !== "CLIENT");
    const db = nodes.find((n) => n.part === "DB");
    const fan = (id: NodeId): number => (rival?.edges ?? []).filter((e) => e.to === id).length;
    target = (db ?? [...nodes].sort((a, b) => fan(b.id) - fan(a.id))[0])?.id;
    if (!target) chosen = available.find((a) => a !== "KILL") ?? chosen;
  }
  let telegraph: Category | null = CATEGORY_OF[chosen];
  if (tier !== "easy" && view.self.feintsLeft > 0 && rng.next() < 0.2) {
    const others = (Object.values(CATEGORY_OF) as Category[]).filter((c) => c !== telegraph);
    telegraph = others[rng.int(others.length)] as Category;
  }
  return { k: "siege.declare", attack: target ? { id: chosen, target } : { id: chosen }, telegraph };
}

function respond(view: PlayerView, tier: BotTier): Intent {
  const cd = view.self.opsCooldown;
  const warn = view.rivalWarning;
  let ops: OpId | null = null;
  const crashed = view.self.effects.some((e) => e.kind === "kill");
  if (crashed && cd.FAILOVER === 0) ops = "FAILOVER";
  else if (tier !== "easy" && (warn === "load" || warn === "writes") && cd.SCALE === 0) ops = "SCALE";
  else if (tier === "hard" && warn === "crash" && cd.FAILOVER === 0 && crashed) ops = "FAILOVER";
  return { k: "siege.respond", ops };
}
