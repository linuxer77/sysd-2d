import type { Design, NodeId, PartId, SimCarry } from "@sysd/sim";
import type { Layout } from "@sysd/match";

/** What a wave of visitors is like. Each kind has a piece that answers it best. */
export type WaveKind = "busy" | "viral" | "crawler" | "bots" | "saving" | "slow" | "boss";

export interface WaveDef {
  readonly n: number;
  readonly kind: WaveKind;
  /** visitors per second before the kind's own effect */
  readonly rps: number;
}

export type Phase = "story" | "prepare" | "result" | "reward" | "over";

export interface NodeOutcome { readonly id: NodeId; readonly part: PartId | "UNKNOWN"; readonly util: number; readonly dropped: number; readonly load: number; readonly dead: boolean }

export interface WaveResult {
  readonly wave: number;
  readonly kind: WaveKind;
  readonly offered: number;
  readonly failed: number;
  readonly served: number;
  readonly earned: number;
  readonly cleanBonus: number;
  readonly spent: number;
  readonly refunded: number;
  readonly crashed: NodeId | null;
  readonly nodes: readonly NodeOutcome[];
  /** the busiest piece, or null if the design could not run */
  readonly busiest: { readonly id: NodeId; readonly part: PartId | "UNKNOWN"; readonly util: number } | null;
  readonly breakerHelped: boolean;
  readonly retryStorm: boolean;
  readonly allowanceAfter: number;
}

export interface RunState {
  readonly seed: number;
  readonly phase: Phase;
  /** 1-based number of the wave being prepared for (or just played) */
  readonly wave: number;
  readonly waves: readonly WaveDef[];
  readonly design: Design;
  readonly layout: Layout;
  readonly money: number;
  readonly allowance: number;
  readonly allowanceMax: number;
  readonly unlocked: readonly PartId[];
  readonly owned: readonly string[];
  readonly offered: readonly string[];
  readonly history: readonly WaveResult[];
  readonly last: WaveResult | null;
  readonly outcome: "won" | "lost" | null;
  readonly carry: SimCarry;
}

export type Intent =
  | { k: "story.done" }
  | { k: "wave.start"; design: Design; layout: Layout }
  | { k: "result.done" }
  | { k: "reward.pick"; id: string };

export type ApplyResult = { ok: true; state: RunState } | { ok: false; reason: string };

export const MAX_WAVE = 8;
export const WAVE_SECONDS = 30;
