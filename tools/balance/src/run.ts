import { NO_CARRY, damage, simulate, type Design, type Mods, type SimResult } from "@sysd/sim";
import { LINKSMASH, RULESET, applyAttack, baseMods, type AttackId } from "@sysd/shared";

export interface Row { attack: string; damage: number; fail: number; p99: number; amp: number; result: SimResult }

export function run(design: Design, attacks: readonly (AttackId | { id: AttackId; target: string })[] = []): Row {
  let mods: Mods = baseMods(LINKSMASH.roundSeconds);
  let label = "none";
  const parts: string[] = [];
  for (const a of attacks) {
    const id = typeof a === "string" ? a : a.id;
    mods = applyAttack(mods, id, typeof a === "string" ? undefined : a.target);
    parts.push(id);
  }
  if (parts.length) label = parts.join("+");
  const { result } = simulate({ design, ruleset: RULESET, scenario: LINKSMASH, mods, carry: NO_CARRY });
  const dmg = damage(result, LINKSMASH, RULESET, mods.durationSec);
  return { attack: label, damage: dmg.total, fail: result.read.userFail, p99: result.read.p99Ms, amp: result.read.amplification, result };
}
