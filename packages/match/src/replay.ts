import { canonicalJson, hash } from "@sysd/sim";
import { apply, tick } from "./reducer.js";
import { createMatch } from "./state.js";
import type { Intent, MatchConfig, MatchState, MoveLog, Seat } from "./types.js";

export const stateHash = (s: MatchState): string => hash(canonicalJson(s));

/** Records every accepted move so a match can be reconstructed exactly: ~2 kilobytes, not a video. */
export class MoveRecorder {
  readonly moves: MoveLog["moves"] = [];
  constructor(readonly config: MatchConfig) {}
  intent(seat: Seat, intent: Intent, now: number): void { this.moves.push({ seat, intent, now }); }
  tick(now: number): void { this.moves.push({ seat: null, intent: null, now }); }
  finish(state: MatchState): MoveLog { return { config: this.config, moves: [...this.moves], finalHash: stateHash(state) }; }
}

/** Re-run a recorded match. Throws if any move is rejected, which would mean the log is not genuine. */
export function replay(log: MoveLog): MatchState {
  let s = createMatch(log.config);
  for (const m of log.moves) {
    if (m.seat === null || m.intent === null) { s = tick(s, m.now); continue; }
    s = tick(s, m.now);
    const r = apply(s, m.seat, m.intent, m.now);
    if (!r.ok) throw new Error(`replay rejected a recorded move: ${r.reason}`);
    s = r.state;
  }
  return s;
}

export function verifyReplay(log: MoveLog): { ok: boolean; state?: MatchState; reason?: string } {
  try {
    const state = replay(log);
    return stateHash(state) === log.finalHash ? { ok: true, state } : { ok: false, reason: "The recorded result does not match." };
  } catch (e) { return { ok: false, reason: e instanceof Error ? e.message : "invalid" }; }
}
