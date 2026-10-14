import type { Mods, NodeId } from "@sysd/sim";
import { NO_MODS } from "@sysd/sim";

export type AttackId = "SPIKE" | "FLUSH" | "KILL" | "LAG" | "WRITE_STORM";

export interface AttackDef {
  readonly id: AttackId;
  readonly name: string;
  readonly pp: number;
  /** rounds the effect persists (1 = this round only) */
  readonly rounds: number;
  readonly needsTarget: boolean;
}

export const ATTACKS: Readonly<Record<AttackId, AttackDef>> = {
  SPIKE:       { id: "SPIKE",       name: "Traffic spike",  pp: 5, rounds: 1, needsTarget: false },
  FLUSH:       { id: "FLUSH",       name: "Cache wipe",    pp: 3, rounds: 2, needsTarget: false },
  KILL:        { id: "KILL",        name: "Server crash",      pp: 3, rounds: 2, needsTarget: true },
  LAG:         { id: "LAG",         name: "Slow database", pp: 5, rounds: 2, needsTarget: false },
  WRITE_STORM: { id: "WRITE_STORM", name: "Burst of new links",    pp: 3, rounds: 1, needsTarget: false },
};

/** Fold one attack into a Mods. Pure; `target` is player-named, never auto-picked. */
export function applyAttack(base: Mods, id: AttackId, target?: NodeId): Mods {
  switch (id) {
    case "SPIKE":       return { ...base, spikeMul: base.spikeMul * 1.8, writeSpikeMul: base.writeSpikeMul * 1.8 };
    case "FLUSH":       return { ...base, flush: true };
    case "KILL":        return target ? { ...base, killed: [...base.killed, target] } : base;
    case "LAG":         return { ...base, latencyAddMs: { ...base.latencyAddMs, DB: 140, REPLICA: 140 } };
    case "WRITE_STORM": return { ...base, writeSpikeMul: base.writeSpikeMul * 8 };
  }
}

export const baseMods = (durationSec: number): Mods => ({ ...NO_MODS, durationSec });
