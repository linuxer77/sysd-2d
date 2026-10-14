import { clone } from "./clone.js";
import type { Design, NodeId, PartId, Policy } from "@sysd/sim";
import { designCost } from "./designs.js";
import { MAX_ROUNDS } from "./state.js";
import { other, type ActiveEffect, type DraftPair, type Layout, type MatchMode, type MatchResult, type Phase, type RoundLog, type Seat, type SeatState, type SiegeStep, type Category } from "./types.js";
import type { MatchState } from "./types.js";

/** What a player is allowed to know about the other player. Never contains hidden configuration. */
export interface RedactedDesign {
  readonly nodes: readonly { id: NodeId; part: PartId | "UNKNOWN" }[];
  readonly edges: readonly { from: NodeId; to: NodeId }[];
  readonly layout: Layout;
  readonly policy: Policy | null;
}

export interface RivalView {
  handle: string;
  picks: string[];
  locked: boolean;
  nodeCount: number;
  spent: number;
  hp: number;
  effects: ActiveEffect[];
  design: RedactedDesign | null;        // null until scouting begins
  reconDone: boolean;
}

export interface PlayerView {
  matchId: string;
  seat: Seat;
  mode: MatchMode;
  scenarioId: string;
  phase: Phase;
  step: SiegeStep | null;
  round: number;
  maxRounds: number;
  deadlineAt: number | null;
  version: number;
  self: SeatState;
  rival: RivalView;
  draft: {
    index: number; total: number; pair: DraftPair | null; yourPick: boolean;
    stage: "choose" | "reveal";
    /** what just happened, shown to both players before the next choice */
    last: { pickedByYou: boolean; taken: string; left: string } | null;
  } | null;
  /** the warning your rival gave for this round, visible once both sides have chosen */
  rivalWarning: Category | null;
  rounds: RoundLog[];
  result: MatchResult | null;
}

/**
 * Fog of war. `RedactedDesign` is a distinct type from `Design`, so feeding what the rival hides into
 * the simulator is a compile error rather than a leak.
 */
export function viewFor(s: MatchState, seat: Seat): PlayerView {
  const me = s.seats[seat], foe = s.seats[other(seat)];
  const scouting = s.phase === "recon" || s.phase === "siege" || s.phase === "review";
  const reveal = s.phase === "review";
  const redacted: RedactedDesign | null = scouting ? {
    nodes: foe.design.nodes.map((n) => ({
      id: n.id,
      part: reveal || n.part === "CLIENT" || me.revealedParts.includes(n.id) ? n.part : "UNKNOWN",
    })),
    edges: foe.design.edges.map((e) => ({ from: e.from, to: e.to })),
    layout: foe.layout,
    policy: reveal || me.revealedPolicy ? foe.design.policy : null,
  } : null;
  const inSiege = s.phase === "siege";
  const pair = s.phase === "draft" ? s.draft.pairs[s.draft.index] ?? null : null;
  return {
    matchId: s.id, seat, mode: s.mode, scenarioId: s.scenarioId, phase: s.phase,
    step: inSiege ? s.siege.step : null, round: s.siege.round, maxRounds: MAX_ROUNDS,
    deadlineAt: s.deadlineAt, version: s.version,
    self: clone(me),
    rival: {
      handle: foe.handle, picks: [...foe.picks], locked: foe.locked,
      nodeCount: s.phase === "build" ? foe.design.nodes.length : foe.design.nodes.length,
      spent: designCost(foe.design), hp: foe.hp,
      effects: clone(foe.effects), design: redacted, reconDone: foe.reconDone,
    },
    draft: s.phase === "draft" ? {
      index: s.draft.index, total: s.draft.pairs.length, pair, yourPick: s.draft.index % 2 === seat, stage: s.draft.stage,
      last: s.draft.lastPick ? { pickedByYou: s.draft.lastPick.seat === seat, taken: s.draft.lastPick.taken, left: s.draft.lastPick.left } : null,
    } : null,
    rivalWarning: inSiege && s.siege.step !== "declare" ? s.siege.telegraphs[other(seat)] : null,
    rounds: s.siege.log.map((r) => {
      const c = clone(r);
      // the rival's hottest pieces are only named if you have scouted them
      const foeSeat = other(seat);
      c.seats[foeSeat].hottest = c.seats[foeSeat].hottest.map((h: { id: NodeId; part: PartId | "UNKNOWN"; util: number }) => ({ ...h, part: reveal || me.revealedParts.includes(h.id) ? h.part : "UNKNOWN" as const }));
      return c;
    }),
    result: s.phase === "review" || (inSiege && s.siege.step === "resolve") ? s.result : null,
  };
}

export type { Design };
