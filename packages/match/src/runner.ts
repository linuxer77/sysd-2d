import { makeRng } from "@sysd/sim";
import { botStep, type BotMemo, type BotTier } from "./bot.js";
import { apply, tick } from "./reducer.js";
import { MoveRecorder } from "./replay.js";
import { createMatch } from "./state.js";
import { viewFor } from "./view.js";
import type { MatchConfig, MatchState, MoveLog, Seat } from "./types.js";

/**
 * Play a whole match between two bots on a simulated clock. Deterministic: the same config and tiers
 * always produce the same match. Used for tests, balance sweeps, and verifying submitted scores.
 */
export function runBotMatch(cfg: MatchConfig, tiers: [BotTier, BotTier] = ["normal", "normal"], stepMs = 1000): { state: MatchState; log: MoveLog } {
  let s = createMatch(cfg);
  const rec = new MoveRecorder(cfg);
  const rngs = [makeRng(cfg.seed + 101), makeRng(cfg.seed + 202)];
  const memos: [BotMemo, BotMemo] = [{}, {}];
  let now = 0;
  for (let guard = 0; guard < 20_000 && s.phase !== "review"; guard++) {
    let progress = false;
    for (const seat of [0, 1] as Seat[]) {
      const intent = botStep(viewFor(s, seat), rngs[seat]!, tiers[seat], memos[seat]);
      if (!intent) continue;
      const r = apply(s, seat, intent, now);
      if (!r.ok) throw new Error(`bot ${seat} made an illegal move (${intent.k}): ${r.reason}`);
      rec.intent(seat, intent, now);
      s = r.state; progress = true;
    }
    if (s.phase === "review") break;
    if (!progress) {
      now += stepMs;
      const next = tick(s, now);
      if (next !== s) { rec.tick(now); s = next; }
    }
  }
  return { state: s, log: rec.finish(s) };
}
