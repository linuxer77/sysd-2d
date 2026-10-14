import { NO_CARRY, compile, damage, simulate, type Mods, type NodeResult, type SimResult } from "@sysd/sim";
import { ATTACKS, RULESET, applyAttack, baseMods, type AttackId } from "@sysd/shared";
import { designCost } from "./designs.js";
import { MAX_ROUNDS, ROUND_DAMAGE_CAP, scenarioOf } from "./state.js";
import {
  CATEGORY_OF, other, type ActiveEffect, type MatchResult, type MatchState, type OpId, type ResultReason,
  type RoundLog, type Seat, type SeatRound, type SeatState,
} from "./types.js";

const EFFECT_OF: Record<AttackId, ActiveEffect["kind"]> = { SPIKE: "spike", FLUSH: "flush", KILL: "kill", LAG: "lag", WRITE_STORM: "storm" };
const ATTACK_OF: Record<string, AttackId> = { spike: "SPIKE", flush: "FLUSH", kill: "KILL", lag: "LAG", storm: "WRITE_STORM" };

export const OP_COOLDOWN: Record<OpId, number> = { FAILOVER: 3, SCALE: 3, SHED: 2 };
export const SHED_HEALTH_COST = 6;

/** Fold a seat's active effects into simulator inputs. */
export function modsFor(seat: SeatState, durationSec: number): Mods {
  let m = baseMods(durationSec);
  for (const e of seat.effects) {
    const atk = ATTACK_OF[e.kind];
    if (atk) m = applyAttack(m, atk, e.target);
    else if (e.kind === "scale") m = { ...m, capMul: m.capMul * 1.6 };
    else if (e.kind === "shed") m = { ...m, shedFrac: 0.4 };
  }
  return m;
}

const emptyBreakdown = { total: 0, availability: 0, latency: 0, writes: 0, dataLoss: 0, staleness: 0 };

function evaluate(s: MatchState, seat: SeatState): { result: SimResult | null; dmg: number; breakdown: SeatRound["breakdown"] } {
  const scenario = scenarioOf(s);
  const mods = modsFor(seat, scenario.roundSeconds);
  if (!compile(seat.design, RULESET).ok) return { result: null, dmg: ROUND_DAMAGE_CAP, breakdown: { ...emptyBreakdown, total: ROUND_DAMAGE_CAP } };
  const out = simulate({ design: seat.design, ruleset: RULESET, scenario, mods, carry: seat.carry });
  seat.carry = out.carry;
  const breakdown = damage(out.result, scenario, RULESET, mods.durationSec);
  return { result: out.result, dmg: Math.min(ROUND_DAMAGE_CAP, Math.round(breakdown.total)), breakdown };
}

/**
 * Resolve one siege round, simultaneously. Both seats' operations apply first, then both attacks are
 * laid on the defender, then each stack is simulated against the traffic it actually faces. Neither
 * seat ever sees the other's choice before committing, so there is no first-mover advantage.
 */
export function resolveRound(s: MatchState): void {
  const round = s.siege.round;
  const rounds: [Partial<SeatRound>, Partial<SeatRound>] = [{}, {}];

  // 1. operations on yourself
  for (const sd of [0, 1] as Seat[]) {
    const seat = s.seats[sd];
    const ops = seat.response?.ops ?? null;
    rounds[sd].ops = ops;
    if (ops === "FAILOVER") seat.effects = seat.effects.filter((e) => e.kind !== "kill");
    if (ops === "SCALE") seat.effects.push({ kind: "scale", remaining: 2 });
    if (ops === "SHED") { seat.effects.push({ kind: "shed", remaining: 2 }); seat.hp -= SHED_HEALTH_COST; }
    if (ops) seat.opsCooldown[ops] = OP_COOLDOWN[ops];
  }

  // 2. attacks on the opponent
  for (const sd of [0, 1] as Seat[]) {
    const me = s.seats[sd], foe = s.seats[other(sd)];
    const d = me.declared;
    const attack = d?.attack ?? null;
    rounds[sd].attack = attack;
    const honest = attack ? CATEGORY_OF[attack.id] : null;
    rounds[sd].telegraph = d?.telegraph ?? null;
    rounds[sd].bluffed = (d?.telegraph ?? null) !== honest && d?.telegraph !== undefined && d?.telegraph !== null;
    rounds[sd].whiffed = false;
    if (rounds[sd].bluffed) me.feintsLeft = Math.max(0, me.feintsLeft - 1);
    if (!attack) continue;
    if (me.attackUses[attack.id] <= 0) { rounds[sd].whiffed = true; continue; }
    me.attackUses[attack.id] -= 1;
    if (attack.id === "KILL" && !(attack.target && foe.design.nodes.some((n) => n.id === attack.target && n.part !== "CLIENT"))) {
      rounds[sd].whiffed = true; continue;
    }
    const def = ATTACKS[attack.id];
    const eff: ActiveEffect = attack.target
      ? { kind: EFFECT_OF[attack.id], remaining: def.rounds, target: attack.target }
      : { kind: EFFECT_OF[attack.id], remaining: def.rounds };
    foe.effects.push(eff);
  }

  // 3. each stack faces the traffic it now has
  const evals = [evaluate(s, s.seats[0]), evaluate(s, s.seats[1])] as const;
  const logSeats = [0, 1].map((i) => {
    const sd = i as Seat, seat = s.seats[sd], ev = evals[sd];
    seat.hp = Math.max(0, seat.hp - ev.dmg);
    const nodes = (ev.result?.nodes ?? []).filter((n): n is NodeResult => n.part !== "CLIENT" && !n.dead)
      .sort((a, b) => b.util - a.util).slice(0, 3).map((n) => ({ id: n.id, part: n.part, util: n.util }));
    const r = rounds[sd];
    const out: SeatRound = {
      attack: r.attack ?? null, telegraph: r.telegraph ?? null, bluffed: r.bluffed ?? false, whiffed: r.whiffed ?? false,
      ops: r.ops ?? null, damageTaken: ev.dmg, breakdown: ev.breakdown, hpAfter: seat.hp,
      readFail: ev.result?.read.userFail ?? 1, readP99Ms: ev.result?.read.p99Ms ?? 0,
      amplification: ev.result?.read.amplification ?? 1, hottest: nodes, findings: ev.result ? [...ev.result.findings] : [],
    };
    return out;
  }) as [SeatRound, SeatRound];
  const log: RoundLog = { round, seats: logSeats };
  s.siege.log.push(log);

  // 4. time passes
  for (const seat of s.seats) {
    seat.effects = seat.effects.map((e) => ({ ...e, remaining: e.remaining - 1 })).filter((e) => e.remaining > 0);
    for (const k of Object.keys(seat.opsCooldown) as OpId[]) seat.opsCooldown[k] = Math.max(0, seat.opsCooldown[k] - 1);
    seat.declared = null; seat.response = null;
  }
  s.siege.telegraphs = [null, null];

  if (s.seats[0].hp <= 0 || s.seats[1].hp <= 0 || round >= MAX_ROUNDS) s.result = decide(s);
}

/** Idle (no attack) read latency, for the third tiebreaker. */
function idleP99(s: MatchState, seat: SeatState): number {
  if (!compile(seat.design, RULESET).ok) return Infinity;
  const sc = scenarioOf(s);
  return simulate({ design: seat.design, ruleset: RULESET, scenario: sc, mods: baseMods(sc.roundSeconds), carry: NO_CARRY }).result.read.p99Ms;
}

/** Health first. Ties go to the cheaper build, then the faster one, then the simpler one. */
export function decide(s: MatchState): MatchResult {
  const [a, b] = s.seats;
  const win = (w: Seat, reason: ResultReason): MatchResult => ({ winner: w, reason });
  if (a.hp !== b.hp) return win(a.hp > b.hp ? 0 : 1, "health");
  const ca = designCost(a.design), cb = designCost(b.design);
  if (ca !== cb) return win(ca < cb ? 0 : 1, "cheaper");
  const pa = idleP99(s, a), pb = idleP99(s, b);
  if (Math.abs(pa - pb) > 1) return win(pa < pb ? 0 : 1, "faster");
  const na = a.design.nodes.length, nb = b.design.nodes.length;
  if (na !== nb) return win(na < nb ? 0 : 1, "simpler");
  return { winner: "draw", reason: "even" };
}
