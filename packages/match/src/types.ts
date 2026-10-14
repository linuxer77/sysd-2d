import type { AttackId } from "@sysd/shared";
import type { DamageBreakdown, Design, Finding, NodeId, PartId, Policy, SimCarry } from "@sysd/sim";

export type Seat = 0 | 1;
export const other = (s: Seat): Seat => (s === 0 ? 1 : 0);

export type Phase = "lobby" | "brief" | "draft" | "build" | "recon" | "siege" | "review";
export type SiegeStep = "declare" | "respond" | "resolve";
export type OpId = "FAILOVER" | "SCALE" | "SHED";
export type MatchMode = "pvp" | "practice" | "daily";

/** What an attack looks like from outside: announced in plain language one step before it lands. */
export type Category = "load" | "cache" | "crash" | "slow" | "writes";
export const CATEGORY_OF: Readonly<Record<AttackId, Category>> = {
  SPIKE: "load", FLUSH: "cache", KILL: "crash", LAG: "slow", WRITE_STORM: "writes",
};

export const WORLD = { w: 1000, h: 640 } as const;
export type Layout = Record<NodeId, { x: number; y: number }>;

export interface DraftBundle { readonly id: string; readonly parts: readonly PartId[] }
export interface DraftPair { readonly a: DraftBundle; readonly b: DraftBundle }

export interface ActiveEffect {
  readonly kind: "spike" | "flush" | "lag" | "storm" | "kill" | "scale" | "shed";
  readonly remaining: number;
  readonly target?: NodeId;
}

export interface AttackChoice { readonly id: AttackId; readonly target?: NodeId }

export interface SeatState {
  handle: string;
  ready: boolean;
  /** has read the problem and is ready to start the draft */
  briefDone: boolean;
  licences: Partial<Record<PartId, number>>;
  picks: string[];
  design: Design;
  layout: Layout;
  locked: boolean;
  lockedAtMs: number | null;
  probesLeft: number;
  revealedParts: NodeId[];
  revealedPolicy: boolean;
  reconDone: boolean;
  hp: number;
  attackUses: Record<AttackId, number>;
  opsCooldown: Record<OpId, number>;
  feintsLeft: number;
  effects: ActiveEffect[];
  carry: SimCarry;
  declared: { attack: AttackChoice | null; telegraph: Category | null } | null;
  response: { ops: OpId | null } | null;
}

export interface SeatRound {
  attack: AttackChoice | null;
  telegraph: Category | null;
  bluffed: boolean;
  /** an attack that named a node that was not there, or that ran out of uses */
  whiffed: boolean;
  ops: OpId | null;
  damageTaken: number;
  breakdown: DamageBreakdown;
  hpAfter: number;
  readFail: number;
  readP99Ms: number;
  amplification: number;
  hottest: { id: NodeId; part: PartId | "UNKNOWN"; util: number }[];
  findings: Finding[];
}
export interface RoundLog { round: number; seats: [SeatRound, SeatRound] }

export type ResultReason = "health" | "cheaper" | "faster" | "simpler" | "even" | "forfeit";
export interface MatchResult { winner: Seat | "draw"; reason: ResultReason }

export interface Durations {
  briefMs: number; draftRevealMs: number; draftPerPairMs: number; buildMs: number; reconMs: number;
  declareMs: number; respondMs: number; resolveMs: number;
}
export const DEFAULT_DURATIONS: Durations = {
  briefMs: 45_000, draftRevealMs: 3_000, draftPerPairMs: 15_000, buildMs: 300_000, reconMs: 30_000,
  declareMs: 25_000, respondMs: 15_000, resolveMs: 28_000,
};

export interface MatchConfig {
  id: string;
  seed: number;
  mode: MatchMode;
  scenarioId: string;
  handles: [string, string];
  durations?: Partial<Durations>;
}

export interface MatchState {
  id: string;
  seed: number;
  mode: MatchMode;
  scenarioId: string;
  durations: Durations;
  phase: Phase;
  deadlineAt: number | null;
  version: number;
  seats: [SeatState, SeatState];
  draft: {
    pairs: DraftPair[]; index: number; history: { pair: number; seat: Seat; bundle: string }[];
    /** "choose": someone is picking. "reveal": the pick was made and both players are shown what each side got. */
    stage: "choose" | "reveal";
    lastPick: { pair: number; seat: Seat; taken: string; left: string } | null;
  };
  siege: { round: number; step: SiegeStep; telegraphs: [Category | null, Category | null]; log: RoundLog[] };
  result: MatchResult | null;
}

export type ProbeTarget = { kind: "part"; nodeId: NodeId } | { kind: "policy" };

export type Intent =
  | { k: "ready" }
  | { k: "brief.done" }
  | { k: "draft.pick"; pair: number; choice: "a" | "b" }
  | { k: "build.update"; design: Design; layout: Layout }
  | { k: "build.lock" }
  | { k: "recon.probe"; target: ProbeTarget }
  | { k: "recon.done" }
  | { k: "siege.declare"; attack: AttackChoice | null; telegraph: Category | null }
  | { k: "siege.respond"; ops: OpId | null }
  | { k: "forfeit" };

export type ApplyResult = { ok: true; state: MatchState } | { ok: false; reason: string };

export interface MoveLog {
  config: MatchConfig;
  moves: { seat: Seat | null; intent: Intent | null; now: number }[];   // seat null + intent null = a clock tick
  finalHash: string;
}

export type { Policy };
