import { clamp, q6 } from "./math.js";
import type { DamageBreakdown, Ruleset, Scenario, SimResult } from "./types.js";

/**
 * Error-budget damage.
 *   bad requests  = (failed after retries) + (successes slower than the SLO)
 *   damage %      = bad / scenario.errorBudgetRequests * 100
 * A request that blew its timeout IS a failed request, so latency and failure
 * are unified (never double-counted). Each term is returned separately so the
 * autopsy can say WHY you lost 31 points.
 */
export function damage(result: SimResult, scenario: Scenario, rules: Ruleset, durationSec: number): DamageBreakdown {
  const D = rules.damage;
  const budget = scenario.errorBudgetRequests;
  const pct = (bad: number): number => (bad / budget) * 100;

  const r = result.read, w = result.write;
  const availability = pct(r.offered * durationSec * r.userFail);
  const latency = pct(r.offered * durationSec * (1 - r.userFail) * r.slowFrac);
  const writes = pct(D.writeWeight * w.offered * durationSec * w.badFrac);
  const dataLoss = pct(D.dataLossWeight * (result.consistency.lostWrites + result.consistency.duplicateWrites) * durationSec);
  const staleFrac = clamp((result.consistency.stalenessMs - scenario.consistencySloMs) / scenario.consistencySloMs, 0, 1);
  const staleness = pct(D.staleWeight * result.consistency.replicaReadRps * durationSec * staleFrac);

  const total = availability + latency + writes + dataLoss + staleness;
  return {
    total: q6(total), availability: q6(availability), latency: q6(latency),
    writes: q6(writes), dataLoss: q6(dataLoss), staleness: q6(staleness),
  };
}

/**
 * The same traffic, told in people: how many visitors arrived and how many were failed. A visitor who got an
 * error counts fully. A visitor who got an answer that was only slow counts half, so being a little overloaded
 * hurts a little and being badly overloaded hurts a lot, instead of every overload being a total loss.
 * Used by the run mode, where the allowance is a count of visitors.
 */
export const SLOW_COUNTS = 0.5;
export function visitors(result: SimResult, durationSec: number): { offered: number; failed: number } {
  const lost = (c: SimResult["read"]): number => c.offered * (c.userFail + (1 - c.userFail) * c.slowFrac * SLOW_COUNTS);
  const offered = (result.read.offered + result.write.offered) * durationSec;
  const failed = (lost(result.read) + lost(result.write)) * durationSec;
  return { offered: q6(offered), failed: q6(Math.min(failed, offered)) };
}
