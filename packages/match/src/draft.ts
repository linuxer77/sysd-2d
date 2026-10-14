import type { PartId } from "@sysd/sim";
import type { DraftBundle, DraftPair } from "./types.js";

/**
 * The mirror draft. Eight pairs; for each, one player chooses a bundle and the OTHER player receives
 * the one left behind, so every pick is both "what do I want" and "what can I afford to hand over".
 * A drafted bundle is a LICENCE to place those pieces. It is not a purchase: you still pay when you
 * place them, so taking a piece you cannot afford still denies it to your opponent.
 *
 * First-pass tables. They are meant to be tuned with the balance harness once real matches exist.
 */
export const STARTER_LICENCES: Readonly<Partial<Record<PartId, number>>> = { LB: 1, APP: 2, DB: 1 };

const B = (id: string, ...parts: PartId[]): DraftBundle => ({ id, parts });

export const DRAFT_PAIRS: readonly DraftPair[] = [
  { a: B("cdn-1", "CDN"),                 b: B("replica-1", "REPLICA") },
  { a: B("apps-2", "APP", "APP"),         b: B("cache-1", "CACHE") },
  { a: B("queue-1", "QUEUE", "WORKER"),   b: B("replica-2", "REPLICA") },
  { a: B("app-1", "APP"),                 b: B("lb-1", "LB") },
  { a: B("cache-2", "CACHE"),             b: B("apps-3", "APP", "APP") },
  { a: B("limiter-1", "RATELIMIT"),       b: B("worker-2", "WORKER") },
  { a: B("replicas-3", "REPLICA", "REPLICA"), b: B("cdn-2", "CDN") },
  { a: B("lb-2", "LB"),                   b: B("queue-2", "QUEUE") },
];

/** Plain-language label for a bundle, built from the part names the player already knows. */
export const bundleParts = (id: string): readonly PartId[] => {
  for (const p of DRAFT_PAIRS) { if (p.a.id === id) return p.a.parts; if (p.b.id === id) return p.b.parts; }
  return [];
};

export function addLicences(
  into: Partial<Record<PartId, number>>, parts: readonly PartId[],
): Partial<Record<PartId, number>> {
  const out = { ...into };
  for (const p of parts) out[p] = (out[p] ?? 0) + 1;
  return out;
}
