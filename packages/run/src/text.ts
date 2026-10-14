import { PART_INFO } from "@sysd/shared";
import type { WaveKind, WaveResult } from "./types.js";

/** Plain-language text for the run. Same rules as all player copy: no abbreviations, ever. */
export interface KindInfo { readonly title: string; readonly what: string; readonly answer: string }

export const KIND_INFO: Readonly<Record<WaveKind, KindInfo>> = {
  busy: { title: "A busy day", what: "More visitors than before. Nothing tricky, but nothing can be too small.", answer: "Look for red pieces. A cache takes work off the database, and another application server takes work off the first." },
  viral: { title: "A link goes viral", what: "Huge numbers of people open the same few links at once.", answer: "A cache answers repeated questions without bothering the database." },
  crawler: { title: "Search crawlers", what: "Programs open thousands of links that nobody has opened before, so caches cannot help.", answer: "Database copies share the reading with the original." },
  bots: { title: "A bot swarm", what: "Automated programs flood your site. They are not real visitors, but they still use up your servers.", answer: "A rate limiter turns bots away without bothering people." },
  saving: { title: "A rush of new links", what: "Far more people than usual save new links at once. Saving is harder work than reading, and it makes caches forget.", answer: "A waiting line and a worker spread the saving out. Database copies take over the reading while the caches recover." },
  slow: { title: "Slow visitors", what: "People on bad connections keep your servers busy for longer, so each server can do much less.", answer: "More application servers." },
  boss: { title: "The big one", what: "A link goes viral, and at the same moment your busiest application server crashes.", answer: "Spare servers, a cache, and a safety switch to keep retries from piling on." },
};

const partName = (p: string): string => (p in PART_INFO ? PART_INFO[p as keyof typeof PART_INFO].fullName.toLowerCase() : "piece");
const thousands = (n: number): string => Math.round(n).toLocaleString("en-US");

export const money = (n: number): string => `$${Math.round(n)}`;

/** One sentence on the one thing that mattered most. */
export function reasonFor(r: WaveResult): string {
  if (r.failed <= 0.005 * r.offered) return "Everything held up. Every visitor got an answer.";
  const dead = r.crashed ? r.nodes.find((n) => n.id === r.crashed) : undefined;
  if (dead && r.failed > 0.2 * r.offered) return `The ${partName(dead.part)} crashed and nothing could take its place.`;
  if (r.retryStorm) return "Failed requests were tried again and again, which piled even more work on pieces that were already struggling.";
  if (r.busiest && r.busiest.util > 1) return `The ${partName(r.busiest.part)} was ${Math.round(r.busiest.util * 100)} percent full. That is more than it can handle, so visitors were turned away or kept waiting.`;
  return "Answers were slower than visitors are willing to wait.";
}

export function summaryLine(r: WaveResult): string {
  return `${thousands(r.offered - r.failed)} of ${thousands(r.offered)} visitors were served. ${thousands(r.failed)} were failed.`;
}
