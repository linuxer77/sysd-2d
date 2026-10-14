import type { BotTier, MatchConfig } from "@sysd/match";
import { LocalSession } from "../session/local";
import { useApp } from "../state/store";

/** Start a match against the computer, entirely in this browser tab. */
export function createLocalMatch(tier: BotTier, opts: { seed?: number } = {}): void {
  const id = "local-" + Math.random().toString(36).slice(2, 8);
  const seed = opts.seed ?? Math.floor(Math.random() * 2_000_000_000);
  const cfg: MatchConfig = { id, seed, mode: "practice", scenarioId: "linksmash", handles: ["You", "Computer"] };
  useApp.getState().setSession(new LocalSession(cfg, tier));
}
