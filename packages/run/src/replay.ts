import { canonicalJson, hash } from "@sysd/sim";
import { apply, createRun } from "./reducer.js";
import type { Intent, RunState } from "./types.js";

export const runHash = (s: RunState): string => hash(canonicalJson(s));

/** A run is its seed plus the moves you made. Replaying them must land on the same state. */
export function replayRun(seed: number, intents: readonly Intent[]): RunState {
  let s = createRun(seed);
  for (const i of intents) { const r = apply(s, i); if (!r.ok) throw new Error(`replay rejected a recorded move: ${r.reason}`); s = r.state; }
  return s;
}
