import { NO_CARRY, makeRng, simulate, validate, visitors, type Design, type NodeId, type PartId } from "@sysd/sim";
import { PART_INFO } from "@sysd/shared";
import { DEFAULT_POLICY, MAX_NODES, WORLD, autoLayout, checkDesignShape, clone, partCounts } from "@sysd/match";
import { ALLOWANCE, SELL_BACK, START_MONEY, costMul, incomeMul, modsExtra, policyFor, priceOf, rulesetFor, scenarioFor } from "./rules.js";
import { STARTER_PARTS, UPGRADES, upgradeById, type Upgrade } from "./upgrades.js";
import { crashTarget, makeWaves, modsForWave } from "./waves.js";
import { MAX_WAVE, WAVE_SECONDS, type ApplyResult, type Intent, type NodeOutcome, type RunState, type WaveResult } from "./types.js";

/** The first service: visitors, one application server, one database, already connected. It is free. */
export function starterDesign(): Design {
  return {
    nodes: [{ id: "n0-1", part: "CLIENT" }, { id: "n0-2", part: "APP" }, { id: "n0-3", part: "DB" }],
    edges: [{ from: "n0-1", to: "n0-2" }, { from: "n0-2", to: "n0-3" }],
    policy: DEFAULT_POLICY,
  };
}

export function createRun(seed: number): RunState {
  const design = starterDesign();
  return {
    seed, phase: "story", wave: 1, waves: makeWaves(seed), design, layout: autoLayout(design),
    money: START_MONEY, allowance: ALLOWANCE, allowanceMax: ALLOWANCE,
    unlocked: [...STARTER_PARTS], owned: [], offered: [], history: [], last: null, outcome: null, carry: NO_CARRY,
  };
}

const name = (p: PartId): string => PART_INFO[p].fullName.toLowerCase();

/** Why a design cannot start the wave, in plain words, or null if it can. */
export function startProblem(s: RunState, design: Design, layout: RunState["layout"]): string | null {
  const shape = checkDesignShape(design, layout);
  if (shape) return shape;
  const rs = rulesetFor(s.owned);
  const err = validate(design, rs, { maxNodes: MAX_NODES }).find((i) => i.severity === "error");
  if (err) {
    switch (err.code) {
      case "cycle": return "Your connections form a loop. Requests need to flow one way.";
      case "client-count": return "A design needs exactly one group of visitors.";
      case "too-many-nodes": return `A design can have at most ${MAX_NODES} pieces.`;
      default: return "Something about the way your pieces are connected is not valid.";
    }
  }
  for (const [part, n] of Object.entries(partCounts(design))) {
    if (part === "CLIENT" || !n) continue;
    if (!s.unlocked.includes(part as PartId)) return `You have not unlocked the ${name(part as PartId)} yet. Rewards unlock new pieces.`;
  }
  if (!design.edges.length) return "Connect your pieces before starting.";
  const { cost, refund } = trade(s, design);
  if (cost - refund > s.money) return `You need $${cost - refund - s.money} more. Sell something, or build less.`;
  return null;
}

/** What this preparation costs: new pieces at full price, pieces you removed sell back for 70 percent. */
export function trade(s: RunState, design: Design): { cost: number; refund: number } {
  const rs = rulesetFor(s.owned);
  const before = new Map(s.design.nodes.map((n) => [n.id, n.part] as const));
  const after = new Map(design.nodes.map((n) => [n.id, n.part] as const));
  let cost = 0, refund = 0;
  for (const [id, part] of after) if (!before.has(id)) cost += priceOf(rs, part, s.owned);
  for (const [id, part] of before) if (!after.has(id)) refund += Math.round(priceOf(rs, part, s.owned) * SELL_BACK);
  return { cost, refund };
}

/** Run one wave against a design. Nothing is charged and nothing is stored: used for the forecast and by playWave. */
function evaluate(s: RunState, design: Design): { result: WaveResult; carry: RunState["carry"]; placed: Design } {
  const rs = rulesetFor(s.owned);
  const wave = s.waves[s.wave - 1] as RunState["waves"][number];
  const scenario = scenarioFor(wave.rps);
  const extra = modsExtra(s.owned);
  const { cost, refund } = trade(s, design);
  const placed: Design = { ...design, policy: policyFor(s.owned, design.policy) };

  // a calm run first, only to know which server is busiest (the one a crash would pick)
  const calm = simulate({ design: placed, ruleset: rs, scenario, mods: modsForWave({ ...wave, kind: "busy" }, placed, {}, extra), carry: s.carry }).result;
  const util: Record<NodeId, number> = {};
  for (const n of calm.nodes) util[n.id] = n.util;
  const mods = modsForWave(wave, placed, util, extra);
  const out = simulate({ design: placed, ruleset: rs, scenario, mods, carry: s.carry });
  const v = visitors(out.result, WAVE_SECONDS);
  const failed = Math.round(v.failed), offered = Math.round(v.offered);
  const clean = failed <= 0.005 * offered;
  const cleanBonus = clean ? 30 : 0;
  const earned = Math.round((50 + ((offered - failed) / 1000) * 0.25) * incomeMul(s.owned)) + cleanBonus;
  const nodes: NodeOutcome[] = out.result.nodes.map((n) => ({ id: n.id, part: n.part, util: n.util, dropped: n.dropped, load: n.loadR + n.loadW, dead: n.dead }));
  const busiest = [...nodes].filter((n) => n.part !== "CLIENT").sort((a, b) => b.util - a.util || (a.id < b.id ? -1 : 1))[0];
  const result: WaveResult = {
    wave: s.wave, kind: wave.kind, offered, failed, served: offered - failed, earned, cleanBonus, spent: cost, refunded: refund,
    crashed: wave.kind === "boss" ? crashTarget(placed, util) : null,
    nodes, busiest: busiest ? { id: busiest.id, part: busiest.part, util: busiest.util } : null,
    breakerHelped: out.result.breakerTripped, retryStorm: out.result.findings.some((f) => f.code === "retry-storm"),
    allowanceAfter: Math.max(0, s.allowance - failed),
  };
  return { result, carry: out.carry, placed };
}

function playWave(s: RunState, design: Design, layout: RunState["layout"]): RunState {
  const { result, carry, placed } = evaluate(s, design);
  return {
    ...s, phase: "result", design: placed, layout: clone(layout), money: s.money - result.spent + result.refunded + result.earned,
    allowance: result.allowanceAfter, history: [...s.history, result], last: result, carry,
  };
}

/** What the coming wave would do to this design, if you started now. Free to ask, and exactly what would really happen. */
export function forecast(s: RunState, design: Design): WaveResult | null {
  if (s.phase !== "prepare") return null;
  try { return evaluate(s, design).result; } catch { return null; }
}

/** Three rewards: one that answers the NEXT wave when there is one, two others, none you already own. */
export function offerUpgrades(s: RunState): readonly string[] {
  const next = s.waves[s.wave];                                   // s.wave is 1-based, so this is the wave after the one just played
  const left = UPGRADES.filter((u) => !s.owned.includes(u.id) && !(u.unlocks && u.unlocks.every((p) => s.unlocked.includes(p))));
  const rng = makeRng(s.seed * 31 + s.wave);
  const shuffle = <T,>(xs: readonly T[]): T[] => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = rng.int(i + 1); const t = a[i] as T; a[i] = a[j] as T; a[j] = t; } return a; };
  const pool = shuffle(left);
  const first: Upgrade | undefined = next ? pool.find((u) => u.helps.includes(next.kind)) : undefined;
  const picked = first ? [first] : [];
  for (const u of pool) { if (picked.length >= 3) break; if (!picked.includes(u)) picked.push(u); }
  return picked.map((u) => u.id);
}

export function apply(s: RunState, intent: Intent): ApplyResult {
  switch (intent.k) {
    case "story.done":
      if (s.phase !== "story") return { ok: false, reason: "The story has already been read." };
      return { ok: true, state: { ...s, phase: "prepare" } };
    case "wave.start": {
      if (s.phase !== "prepare") return { ok: false, reason: "You can only start a wave while preparing." };
      const design = clone(intent.design), layout = clone(intent.layout);
      const why = startProblem(s, design, layout);
      if (why) return { ok: false, reason: why };
      return { ok: true, state: playWave(s, design, layout) };
    }
    case "result.done": {
      if (s.phase !== "result") return { ok: false, reason: "There is no result to close." };
      if (s.allowance <= 0) return { ok: true, state: { ...s, phase: "over", outcome: "lost" } };
      if (s.wave >= MAX_WAVE) return { ok: true, state: { ...s, phase: "over", outcome: "won" } };
      return { ok: true, state: { ...s, phase: "reward", offered: offerUpgrades(s) } };
    }
    case "reward.pick": {
      if (s.phase !== "reward") return { ok: false, reason: "There is no reward to pick." };
      if (!s.offered.includes(intent.id)) return { ok: false, reason: "That reward was not offered." };
      const u = upgradeById(intent.id) as Upgrade;
      const unlocked = [...s.unlocked];
      for (const p of u.unlocks ?? []) if (!unlocked.includes(p)) unlocked.push(p);
      return { ok: true, state: { ...s, phase: "prepare", wave: s.wave + 1, owned: [...s.owned, u.id], unlocked, offered: [], money: s.money + (u.id === "m-cash" ? 150 : 0) } };
    }
  }
}

export const nextWave = (s: RunState) => s.waves[s.wave - 1];
export { WORLD, costMul };
