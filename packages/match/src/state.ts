import { NO_CARRY, makeRng, type Design, type NodeId } from "@sysd/sim";
import { ATTACKS, LINKSMASH, SCENARIOS, type AttackId } from "@sysd/shared";
import { DRAFT_PAIRS, STARTER_LICENCES } from "./draft.js";
import { DEFAULT_POLICY } from "./designs.js";
import {
  DEFAULT_DURATIONS, WORLD, type Durations, type Layout, type MatchConfig, type MatchState, type OpId, type Seat, type SeatState,
} from "./types.js";

export const MAX_ROUNDS = 6;
export const MAX_NODES = 16;
export const MAX_EDGES = 48;
export const START_HP = 100;
export const ROUND_DAMAGE_CAP = 45;

export const scenarioOf = (s: MatchState) => (SCENARIOS as Record<string, typeof LINKSMASH>)[s.scenarioId] ?? LINKSMASH;

function newSeat(seat: Seat, handle: string): SeatState {
  const client = `n${seat}-1`;
  const attackUses = {} as Record<AttackId, number>;
  for (const a of Object.values(ATTACKS)) attackUses[a.id] = a.pp;
  return {
    handle, ready: false, briefDone: false,
    licences: { ...STARTER_LICENCES },
    picks: [],
    design: { nodes: [{ id: client, part: "CLIENT" }], edges: [], policy: DEFAULT_POLICY },
    layout: { [client]: { x: 100, y: WORLD.h / 2 } },
    locked: false, lockedAtMs: null, probesLeft: 0, revealedParts: [], revealedPolicy: false, reconDone: false,
    hp: START_HP, attackUses, opsCooldown: { FAILOVER: 0, SCALE: 0, SHED: 0 } as Record<OpId, number>,
    feintsLeft: 2, effects: [], carry: NO_CARRY, declared: null, response: null,
  };
}

/** Pure and deterministic: the same config always yields the same match. */
export function createMatch(cfg: MatchConfig): MatchState {
  const rng = makeRng(cfg.seed);
  const durations: Durations = { ...DEFAULT_DURATIONS, ...(cfg.durations ?? {}) };
  const pairs = DRAFT_PAIRS.map((p) => (rng.next() < 0.5 ? p : { a: p.b, b: p.a }));
  return {
    id: cfg.id, seed: cfg.seed, mode: cfg.mode, scenarioId: cfg.scenarioId, durations,
    phase: "lobby", deadlineAt: null, version: 0,
    seats: [newSeat(0, cfg.handles[0]), newSeat(1, cfg.handles[1])],
    draft: { pairs, index: 0, history: [], stage: "choose", lastPick: null },
    siege: { round: 0, step: "declare", telegraphs: [null, null], log: [] },
    result: null,
  };
}

const ID_RE = /^[a-z][a-z0-9_-]{0,31}$/;
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** Cheap shape checks for the live editor. Cost and licences are checked only at lock-in. */
export function checkDesignShape(design: Design, layout: Layout): string | null {
  if (!design || !Array.isArray(design.nodes) || !Array.isArray(design.edges)) return "That design is not in a form the game understands.";
  if (design.nodes.length > MAX_NODES) return `A design can have at most ${MAX_NODES} pieces.`;
  if (design.edges.length > MAX_EDGES) return `A design can have at most ${MAX_EDGES} connections.`;
  const ids = new Set<NodeId>();
  for (const n of design.nodes) {
    if (typeof n.id !== "string" || !ID_RE.test(n.id)) return "A piece has an invalid name.";
    if (ids.has(n.id)) return "Two pieces have the same name.";
    ids.add(n.id);
  }
  for (const n of design.nodes) {
    const p = layout?.[n.id];
    if (!p || !finite(p.x) || !finite(p.y) || p.x < 0 || p.y < 0 || p.x > WORLD.w || p.y > WORLD.h) return "A piece is placed outside the board.";
  }
  const pol = design.policy;
  if (!pol || !finite(pol.readTimeoutMs) || !finite(pol.writeTimeoutMs) || !finite(pol.retries) || !finite(pol.retryBudgetPct)) return "The policy settings are not valid.";
  return null;
}

export function effectLabelKinds(): readonly string[] { return ["spike", "flush", "lag", "storm", "kill", "scale", "shed"]; }
