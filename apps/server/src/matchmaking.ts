export interface QueueEntry { userId: string; elo: number; since: number }

/** How far apart two ratings may be after waiting. Starts tight, widens every 15 seconds, capped. */
export const searchBand = (waitedMs: number): number => Math.min(400, 120 + Math.floor(waitedMs / 15_000) * 40);

/**
 * Pure pairing: walk the queue oldest-first and give each player the closest-rated opponent who is
 * inside BOTH players' current search bands. Deterministic, so it is easy to test.
 */
export function findPairs(queue: readonly QueueEntry[], now: number): [QueueEntry, QueueEntry][] {
  const waiting = [...queue].sort((a, b) => a.since - b.since || (a.userId < b.userId ? -1 : 1));
  const used = new Set<string>();
  const pairs: [QueueEntry, QueueEntry][] = [];
  for (const a of waiting) {
    if (used.has(a.userId)) continue;
    let best: QueueEntry | null = null;
    for (const b of waiting) {
      if (b.userId === a.userId || used.has(b.userId)) continue;
      const gap = Math.abs(a.elo - b.elo);
      if (gap > searchBand(now - a.since) || gap > searchBand(now - b.since)) continue;
      if (!best || gap < Math.abs(a.elo - best.elo)) best = b;
    }
    if (best) { used.add(a.userId); used.add(best.userId); pairs.push([a, best]); }
  }
  return pairs;
}
