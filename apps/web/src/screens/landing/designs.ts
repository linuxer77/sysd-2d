import { NO_CARRY, damage, simulate, type Design } from "@sysd/sim";
import { LINKSMASH, RULESET, applyAttack, baseMods, type AttackId } from "@sysd/shared";
import { autoLayout, buildGenome } from "@sysd/match";

/** The playground starts with a small, working service: two servers and a cache. */
export const START = buildGenome({ apps: 2, cache: true, cdn: false, replicas: 1, queue: false, limiter: false, breaker: false, retries: 1, idempotent: true });
export const startLayout = () => autoLayout(START);

export type Moment = "normal" | AttackId;
export const MOMENTS: { id: Moment; label: string }[] = [
  { id: "normal", label: "A normal day" }, { id: "SPIKE", label: "A traffic spike" }, { id: "KILL", label: "A server crash" }, { id: "FLUSH", label: "A cache wipe" },
];

export function momentMods(d: Design, utilOf: Record<string, number>, m: Moment): ReturnType<typeof baseMods> {
  const b = baseMods(LINKSMASH.roundSeconds);
  if (m === "normal") return b;
  if (m !== "KILL") return applyAttack(b, m);
  const hit = d.nodes.filter((n) => n.part === "APP").sort((x, y) => (utilOf[y.id] ?? 0) - (utilOf[x.id] ?? 0))[0]
    ?? d.nodes.filter((n) => n.part !== "CLIENT")[0];
  return applyAttack(b, "KILL", hit?.id);
}

export function run(d: Design, mods: ReturnType<typeof baseMods>): { util: Record<string, number>; hurt: number } | null {
  try {
    const r = simulate({ design: d, ruleset: RULESET, scenario: LINKSMASH, mods, carry: NO_CARRY }).result;
    if (!r.nodes.length) return null;
    const util: Record<string, number> = {};
    for (const n of r.nodes) util[n.id] = n.util;
    return { util, hurt: Math.round(damage(r, LINKSMASH, RULESET, mods.durationSec).total) };
  } catch { return null; }
}
