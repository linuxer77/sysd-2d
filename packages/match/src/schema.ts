import { z } from "zod";
import type { Intent } from "./types.js";

const part = z.enum(["CLIENT", "LB", "APP", "CACHE", "CDN", "DB", "REPLICA", "QUEUE", "WORKER", "RATELIMIT"]);
const nodeId = z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/);
const attackId = z.enum(["SPIKE", "FLUSH", "KILL", "LAG", "WRITE_STORM"]);
const category = z.enum(["load", "cache", "crash", "slow", "writes"]);

export const DesignSchema = z.object({
  nodes: z.array(z.object({ id: nodeId, part })).max(16),
  edges: z.array(z.object({ from: nodeId, to: nodeId, pin: z.enum(["read", "write"]).optional() })).max(48),
  policy: z.object({
    readTimeoutMs: z.number().finite(), writeTimeoutMs: z.number().finite(), retries: z.number().int(),
    breaker: z.boolean(), retryBudgetPct: z.number().finite(), idempotentWrites: z.boolean(),
  }),
});
export const LayoutSchema = z.record(nodeId, z.object({ x: z.number().finite(), y: z.number().finite() }));

export const IntentSchema = z.discriminatedUnion("k", [
  z.object({ k: z.literal("ready") }),
  z.object({ k: z.literal("brief.done") }),
  z.object({ k: z.literal("draft.pick"), pair: z.number().int().min(0).max(20), choice: z.enum(["a", "b"]) }),
  z.object({ k: z.literal("build.update"), design: DesignSchema, layout: LayoutSchema }),
  z.object({ k: z.literal("build.lock") }),
  z.object({ k: z.literal("recon.probe"), target: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("part"), nodeId }), z.object({ kind: z.literal("policy") }),
  ]) }),
  z.object({ k: z.literal("recon.done") }),
  z.object({ k: z.literal("siege.declare"),
    attack: z.object({ id: attackId, target: nodeId.optional() }).nullable(), telegraph: category.nullable() }),
  z.object({ k: z.literal("siege.respond"), ops: z.enum(["FAILOVER", "SCALE", "SHED"]).nullable() }),
  z.object({ k: z.literal("forfeit") }),
]);

/** Everything crossing the wire is parsed with this first. The envelope never carries a result. */
export function parseIntent(raw: unknown): { ok: true; intent: Intent } | { ok: false } {
  const r = IntentSchema.safeParse(raw);
  // zod has validated the shape; its optional fields are typed `| undefined`, which this project's
  // strict optional-property setting rejects, so narrow to the real Intent type once, here.
  return r.success ? { ok: true, intent: JSON.parse(JSON.stringify(r.data)) as Intent } : { ok: false };
}
