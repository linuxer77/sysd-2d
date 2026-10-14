import { NO_CARRY, type Design, type Mods, type PartDef, type PartId, type Policy, type Ruleset, type Scenario } from "@sysd/sim";
import { LINKSMASH, RULESET } from "@sysd/shared";
import { DEFAULT_POLICY } from "@sysd/match";

/** The run's own copy of the rules: a rate limiter that tells bots from people turns almost nobody real away. */
const BASE: Ruleset = {
  ...RULESET,
  parts: { ...RULESET.parts, RATELIMIT: { ...RULESET.parts.RATELIMIT, shedRate: 0.03 } },
};

export const START_MONEY = 200;
export const ALLOWANCE = 300000;
export const SELL_BACK = 0.7;

const has = (owned: readonly string[], id: string): boolean => owned.includes(id);

/** The rules after the upgrades you own. */
export function rulesetFor(owned: readonly string[]): Ruleset {
  const parts: Record<string, PartDef> = { ...BASE.parts };
  if (has(owned, "b-cache")) {
    const c = parts["CACHE"] as PartDef;
    parts["CACHE"] = { ...c, hitRate: Math.min(0.92, (c.hitRate ?? 0) * 1.2) };
  }
  return { ...BASE, parts: parts as Record<PartId, PartDef> };
}

/** Upgrades that act on the traffic's reach rather than on a piece's numbers. */
export function modsExtra(owned: readonly string[]): Pick<Mods, "partCapMul" | "warmupMul"> {
  const cap: Record<string, number> = {};
  if (has(owned, "b-servers")) cap["APP"] = 1.3;
  if (has(owned, "b-database")) { cap["DB"] = 1.4; cap["REPLICA"] = 1.4; }
  return { partCapMul: cap, warmupMul: has(owned, "b-refill") ? 0.5 : 1 };
}

export function policyFor(owned: readonly string[], base: Policy = DEFAULT_POLICY): Policy {
  return { ...base, breaker: has(owned, "b-breaker") ? true : base.breaker, retries: has(owned, "b-retry") ? Math.min(base.retries, 1) : base.retries };
}

export const costMul = (owned: readonly string[]): number => (has(owned, "b-cheap") ? 0.85 : 1);
export const incomeMul = (owned: readonly string[]): number => (has(owned, "m-income") ? 1.25 : 1);

export const priceOf = (rs: Ruleset, part: PartId, owned: readonly string[]): number => Math.round(rs.parts[part].cost * costMul(owned));

export function scenarioFor(rps: number): Scenario { return { ...LINKSMASH, rps }; }
export { NO_CARRY };
