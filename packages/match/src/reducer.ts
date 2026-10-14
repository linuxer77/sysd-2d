import { clone } from "./clone.js";
import { compile, simulate, damage, NO_CARRY, validate, type Design } from "@sysd/sim";
import { LINKSMASH, RULESET, baseMods } from "@sysd/shared";
import { addLicences } from "./draft.js";
import { autoLayout, designCost, partCounts, starterDesign } from "./designs.js";
import { resolveRound, decide } from "./siege.js";
import { MAX_ROUNDS, MAX_NODES, checkDesignShape, scenarioOf } from "./state.js";
import {
  CATEGORY_OF, other, type ApplyResult, type Intent, type MatchState, type OpId, type Seat,
} from "./types.js";

const PROBE_BASE = 3;
const PROBE_PART_COST = 1;
const PROBE_POLICY_COST = 2;

/** Why a design cannot be locked in, in plain words, or null if it can. */
export function lockProblem(s: MatchState, seat: Seat): string | null {
  const me = s.seats[seat];
  const shape = checkDesignShape(me.design, me.layout);
  if (shape) return shape;
  const sc = scenarioOf(s);
  const issues = validate(me.design, RULESET, { budget: sc.budget, maxNodes: MAX_NODES });
  const err = issues.find((i) => i.severity === "error");
  if (err) {
    switch (err.code) {
      case "over-budget": return "You have spent more than your budget. Remove something to lock in.";
      case "cycle": return "Your connections form a loop. Requests need to flow one way.";
      case "client-count": return "A design needs exactly one group of visitors.";
      case "too-many-nodes": return `A design can have at most ${MAX_NODES} pieces.`;
      default: return "Something about the way your pieces are connected is not valid.";
    }
  }
  const have = partCounts(me.design);
  for (const [part, n] of Object.entries(have)) {
    if (part === "CLIENT") continue;
    const allowed = (me.licences as Record<string, number>)[part] ?? 0;
    if ((n as number) > allowed) return "You are using a piece you do not have. Pieces come from the starter set and from the draft.";
  }
  if (!me.design.edges.length) return "Connect your pieces before locking in.";
  return null;
}

const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

export function apply(prev: MatchState, seat: Seat, intent: Intent, now: number): ApplyResult {
  const s = clone(prev);
  const err = step(s, seat, intent, now);
  if (err) return fail(err);
  s.version += 1;
  return { ok: true, state: s };
}

/** Advance any deadlines that have passed. Safe to call as often as you like. */
export function tick(prev: MatchState, now: number): MatchState {
  let s = prev;
  for (let i = 0; i < 64; i++) {
    if (s.deadlineAt === null || now < s.deadlineAt) break;
    const next = clone(s);
    expire(next, now);
    next.version += 1;
    s = next;
  }
  return s;
}

function step(s: MatchState, seat: Seat, intent: Intent, now: number): string | null {
  const me = s.seats[seat], foe = s.seats[other(seat)];
  if (intent.k === "forfeit") {
    if (s.phase === "review") return "The match is already over.";
    s.result = { winner: other(seat), reason: "forfeit" };
    s.phase = "review"; s.deadlineAt = null;
    return null;
  }
  switch (intent.k) {
    case "ready": {
      // idempotent: the server readies a player when they connect, so a late "ready" must not be an error
      if (s.phase !== "lobby") return me.ready ? null : "The match has already started.";
      me.ready = true;
      if (s.seats[0].ready && s.seats[1].ready) enterBrief(s, now);
      return null;
    }
    case "brief.done": {
      if (s.phase !== "brief") return me.briefDone ? null : "It is not the briefing.";
      me.briefDone = true;
      if (s.seats[0].briefDone && s.seats[1].briefDone) enterDraft(s, now);
      return null;
    }
    case "draft.pick": {
      if (s.phase !== "draft") return "It is not the drafting stage.";
      if (s.draft.stage !== "choose") return "Wait. The last choice is still being shown.";
      if (intent.pair !== s.draft.index) return "That choice is no longer open.";
      if (s.draft.index % 2 !== seat) return "It is your rival's turn to choose. You get whatever they leave.";
      pick(s, seat, intent.choice, now);
      return null;
    }
    case "build.update": {
      if (s.phase !== "build") return "You can only change your design while building.";
      if (me.locked) return "Your design is locked in.";
      const bad = checkDesignShape(intent.design, intent.layout);
      if (bad) return bad;
      me.design = intent.design; me.layout = intent.layout;
      return null;
    }
    case "build.lock": {
      if (s.phase !== "build") return "It is not the building stage.";
      if (me.locked) return null;
      const why = lockProblem(s, seat);
      if (why) return why;
      me.locked = true; me.lockedAtMs = now;
      if (s.seats[0].locked && s.seats[1].locked) enterRecon(s, now);
      return null;
    }
    case "recon.probe": {
      if (s.phase !== "recon") return "You can only scout during the scouting stage.";
      if (me.reconDone) return "You have finished scouting.";
      const t = intent.target;
      if (t.kind === "policy") {
        if (me.revealedPolicy) return "You already know your rival's settings.";
        if (me.probesLeft < PROBE_POLICY_COST) return "You do not have enough scouting points.";
        me.probesLeft -= PROBE_POLICY_COST; me.revealedPolicy = true;
        return null;
      }
      if (!foe.design.nodes.some((n) => n.id === t.nodeId)) return "That piece does not exist.";
      if (me.revealedParts.includes(t.nodeId)) return "You already know what that piece is.";
      if (me.probesLeft < PROBE_PART_COST) return "You do not have enough scouting points.";
      me.probesLeft -= PROBE_PART_COST; me.revealedParts.push(t.nodeId);
      return null;
    }
    case "recon.done": {
      if (s.phase !== "recon") return "It is not the scouting stage.";
      me.reconDone = true;
      if (s.seats[0].reconDone && s.seats[1].reconDone) enterSiege(s, now);
      return null;
    }
    case "siege.declare": {
      if (s.phase !== "siege" || s.siege.step !== "declare") return "It is not time to choose an attack.";
      if (me.declared) return "You have already chosen this round.";
      const a = intent.attack;
      if (a) {
        if (me.attackUses[a.id] === undefined || me.attackUses[a.id] <= 0) return "You have no uses of that attack left.";
        if (a.id === "KILL") {
          if (!a.target || !foe.design.nodes.some((n) => n.id === a.target && n.part !== "CLIENT")) return "Choose which of your rival's pieces to crash.";
        }
      }
      const honest = a ? CATEGORY_OF[a.id] : null;
      const tele = intent.telegraph;
      const bluff = tele !== null && tele !== honest;
      if (bluff && me.feintsLeft <= 0) return "You have no bluffs left. Your warning must match your attack.";
      me.declared = { attack: a, telegraph: tele ?? honest };
      if (s.seats[0].declared && s.seats[1].declared) beginRespond(s, now);
      return null;
    }
    case "siege.respond": {
      if (s.phase !== "siege" || s.siege.step !== "respond") return "It is not time to choose a defence.";
      if (me.response) return "You have already chosen this round.";
      if (intent.ops && me.opsCooldown[intent.ops] > 0) return "That operation is still recharging.";
      me.response = { ops: intent.ops };
      if (s.seats[0].response && s.seats[1].response) finishRound(s, now);
      return null;
    }
  }
  return "That action is not allowed right now.";
}

/* ------------------------------------------------------------------ transitions */

/** The problem is explained first, with time to read it, before anyone is asked to choose anything. */
function enterBrief(s: MatchState, now: number): void {
  s.phase = "brief"; s.deadlineAt = now + s.durations.briefMs;
}

function enterDraft(s: MatchState, now: number): void {
  s.phase = "draft"; s.draft.index = 0; s.draft.stage = "choose"; s.draft.lastPick = null;
  s.deadlineAt = now + s.durations.draftPerPairMs;
}

function pick(s: MatchState, picker: Seat, choice: "a" | "b", now: number): void {
  const pair = s.draft.pairs[s.draft.index];
  if (!pair) return;
  const mine = choice === "a" ? pair.a : pair.b, theirs = choice === "a" ? pair.b : pair.a;
  s.seats[picker].licences = addLicences(s.seats[picker].licences, mine.parts);
  s.seats[other(picker)].licences = addLicences(s.seats[other(picker)].licences, theirs.parts);
  s.seats[picker].picks.push(mine.id); s.seats[other(picker)].picks.push(theirs.id);
  s.draft.history.push({ pair: s.draft.index, seat: picker, bundle: mine.id }, { pair: s.draft.index, seat: other(picker), bundle: theirs.id });
  // Do not jump to the next question. Show both players what happened first.
  s.draft.stage = "reveal";
  s.draft.lastPick = { pair: s.draft.index, seat: picker, taken: mine.id, left: theirs.id };
  s.deadlineAt = now + s.durations.draftRevealMs;
}

function advanceDraft(s: MatchState, now: number): void {
  s.draft.index += 1;
  s.draft.stage = "choose";
  if (s.draft.index >= s.draft.pairs.length) enterBuild(s, now);
  else s.deadlineAt = now + s.durations.draftPerPairMs;
}

function enterBuild(s: MatchState, now: number): void {
  s.phase = "build"; s.deadlineAt = now + s.durations.buildMs;
}

/** Quick check used for the early-lock bonus: you cannot earn tempo by rushing something broken. */
function idleDamage(s: MatchState, d: Design): number {
  if (!compile(d, RULESET).ok) return Infinity;
  const sc = scenarioOf(s);
  const r = simulate({ design: d, ruleset: RULESET, scenario: sc, mods: baseMods(sc.roundSeconds), carry: NO_CARRY }).result;
  return damage(r, sc, RULESET, sc.roundSeconds).total;
}

function enterRecon(s: MatchState, now: number): void {
  const buildEnds = s.deadlineAt ?? now;
  for (const seat of s.seats) {
    // finishing early earns up to two extra scouting points, but only for a design that actually works
    let bonus = 0;
    if (seat.lockedAtMs !== null && idleDamage(s, seat.design) < 5) bonus = Math.max(0, Math.min(2, Math.floor((buildEnds - seat.lockedAtMs) / 60_000)));
    seat.probesLeft = PROBE_BASE + bonus;
    seat.reconDone = false;
  }
  s.phase = "recon"; s.deadlineAt = now + s.durations.reconMs;
}

function enterSiege(s: MatchState, now: number): void {
  s.phase = "siege"; s.siege.round = 1; s.siege.step = "declare"; s.siege.telegraphs = [null, null];
  s.deadlineAt = now + s.durations.declareMs;
}

function beginRespond(s: MatchState, now: number): void {
  s.siege.step = "respond";
  s.siege.telegraphs = [s.seats[0].declared?.telegraph ?? null, s.seats[1].declared?.telegraph ?? null];
  s.deadlineAt = now + s.durations.respondMs;
}

function finishRound(s: MatchState, now: number): void {
  resolveRound(s);
  s.siege.step = "resolve";
  s.deadlineAt = now + s.durations.resolveMs;
}

function toReview(s: MatchState): void {
  s.phase = "review"; s.deadlineAt = null;
  if (!s.result) s.result = decide(s);
}

/** A deadline passed: do the sensible default for whoever has not acted. */
function expire(s: MatchState, now: number): void {
  switch (s.phase) {
    case "brief": { enterDraft(s, now); return; }
    case "draft": {
      if (s.draft.stage === "reveal") advanceDraft(s, now);
      else pick(s, (s.draft.index % 2) as Seat, "a", now);
      return;
    }
    case "build": {
      for (const sd of [0, 1] as Seat[]) {
        const seat = s.seats[sd];
        if (seat.locked) continue;
        if (lockProblem(s, sd)) { seat.design = starterDesign(sd); seat.layout = autoLayout(seat.design); }
        seat.locked = true; seat.lockedAtMs = now;
      }
      enterRecon(s, now);
      return;
    }
    case "recon": { enterSiege(s, now); return; }
    case "siege": {
      if (s.siege.step === "declare") {
        for (const seat of s.seats) if (!seat.declared) seat.declared = { attack: null, telegraph: null };
        beginRespond(s, now);
      } else if (s.siege.step === "respond") {
        for (const seat of s.seats) if (!seat.response) seat.response = { ops: null as OpId | null };
        finishRound(s, now);
      } else {
        if (s.result || s.siege.round >= MAX_ROUNDS) { toReview(s); return; }
        s.siege.round += 1; s.siege.step = "declare"; s.deadlineAt = now + s.durations.declareMs;
      }
      return;
    }
    default: s.deadlineAt = null;
  }
}

export { designCost };
