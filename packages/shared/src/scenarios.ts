import type { Scenario } from "@sysd/sim";

/**
 * Linksmash — a URL shortener gone viral.
 * 1M new links/day vs 100M redirects/day => ~1:100 write ratio.
 * Peak is 5x the ~1.2k rps average, so ~6k rps offered at peak.
 */
export const LINKSMASH: Scenario = {
  id: "linksmash",
  rps: 6000,
  writeRatio: 1 / 101,
  sloP99Ms: 100,
  writeSloP99Ms: 400,
  consistencySloMs: 1000,
  budget: 700,
  roundSeconds: 30,
  errorBudgetRequests: 750000,
};

export const SCENARIOS = { linksmash: LINKSMASH } as const;
