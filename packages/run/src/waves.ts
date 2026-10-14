import { makeRng, type Design, type Mods, type NodeId } from "@sysd/sim";
import { applyAttack, baseMods } from "@sysd/shared";
import { MAX_WAVE, WAVE_SECONDS, type WaveDef, type WaveKind } from "./types.js";

/** Visitors per second, wave by wave. Calm at first, then steeply harder. */
export const RAMP: readonly number[] = [1800, 3000, 4400, 5800, 7200, 8600, 10000, 11000];
const MIDDLE: readonly WaveKind[] = ["viral", "crawler", "bots", "saving", "slow"];

/** The whole act, decided by the seed alone: two plain days, five different problems in a shuffled order, then the big one. */
export function makeWaves(seed: number): readonly WaveDef[] {
  const rng = makeRng(seed ^ 0x5eed);
  const order = [...MIDDLE];
  for (let i = order.length - 1; i > 0; i--) { const j = rng.int(i + 1); const t = order[i] as WaveKind; order[i] = order[j] as WaveKind; order[j] = t; }
  const kinds: WaveKind[] = ["busy", "busy", ...order, "boss"];
  return kinds.map((kind, i) => ({ n: i + 1, kind, rps: RAMP[i] as number })).slice(0, MAX_WAVE);
}

/**
 * What a wave does to the simulator. `util` is how full each piece was on a calm day, used only to pick which
 * server a crash hits: the busiest one, which is the one that hurts most.
 */
export function modsForWave(w: WaveDef, design: Design, util: Readonly<Record<NodeId, number>>, extra: Pick<Mods, "partCapMul" | "warmupMul">): Mods {
  let m: Mods = { ...baseMods(WAVE_SECONDS), ...extra };
  const cap = { ...(extra.partCapMul ?? {}) };
  switch (w.kind) {
    case "busy": break;
    case "viral": m = { ...m, spikeMul: 1.8, hitBoost: 0.3 }; break;
    case "crawler": m = { ...m, spikeMul: 1.5, uniqueReadFrac: 0.6 }; break;
    case "bots": m = { ...m, botRps: w.rps, botBlock: { RATELIMIT: 0.92 } }; break;
    case "saving": m = { ...m, writeSpikeMul: 30 }; break;
    case "slow": m = { ...m, spikeMul: 1.2, partCapMul: { ...cap, APP: (cap["APP"] ?? 1) * 0.6 } }; break;
    case "boss": {
      m = { ...m, spikeMul: 2, hitBoost: 0.2 };
      const target = crashTarget(design, util);
      if (target) m = applyAttack(m, "KILL", target);
      break;
    }
  }
  return m;
}

export function crashTarget(design: Design, util: Readonly<Record<NodeId, number>>): NodeId | null {
  const apps = design.nodes.filter((n) => n.part === "APP");
  const pool = apps.length ? apps : design.nodes.filter((n) => n.part !== "CLIENT");
  if (!pool.length) return null;
  const sorted = [...pool].sort((a, b) => (util[b.id] ?? 0) - (util[a.id] ?? 0) || (a.id < b.id ? -1 : 1));
  return (sorted[0] as { id: NodeId }).id;
}
