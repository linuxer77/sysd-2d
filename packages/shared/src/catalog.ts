import type { ClassSet, PartDef, PartId, Ruleset } from "@sysd/sim";

const S = (read: boolean, write: boolean, repl = false): ClassSet => ({ read, write, repl });
const NONE = S(false, false);
const RW = S(true, true);

/** Catalog DATA. The engine defines the shape; this file is what the balance harness tunes. */
export const PARTS: Readonly<Record<PartId, PartDef>> = {
  CLIENT: {
    id: "CLIENT", cost: 0, capacity: 1e9, baseLatencyMs: 0,
    accepts: NONE, emits: RW, routing: "cascade", tierPriority: 9,
    readCost: 1, writeCost: 1, replCost: 0, shipCost: 0, tag: "entry",
  },
  LB: {
    id: "LB", cost: 60, capacity: 60000, baseLatencyMs: 2,
    accepts: RW, emits: RW, routing: "balance", tierPriority: 5,
    readCost: 1, writeCost: 1, replCost: 0, shipCost: 0, tag: "edge",
  },
  APP: {
    id: "APP", cost: 80, capacity: 5000, baseLatencyMs: 8,
    accepts: RW, emits: RW, routing: "cascade", tierPriority: 5,
    readCost: 1, writeCost: 1.2, replCost: 0, shipCost: 0, tag: "compute",
  },
  CACHE: {
    id: "CACHE", cost: 70, capacity: 45000, baseLatencyMs: 3,
    accepts: S(true, false), emits: S(true, false), routing: "cascade", tierPriority: 0,
    readCost: 1, writeCost: 1, replCost: 0, shipCost: 0,
    hitRate: 0.70, invalidationSensitivity: 2.0, tag: "cache",
  },
  CDN: {
    id: "CDN", cost: 90, capacity: 250000, baseLatencyMs: 1,
    accepts: S(true, false), emits: S(true, false), routing: "cascade", tierPriority: 1,
    readCost: 1, writeCost: 1, replCost: 0, shipCost: 0,
    hitRate: 0.55, invalidationSensitivity: 0.5, tag: "cache",
  },
  DB: {
    id: "DB", cost: 150, capacity: 3000, baseLatencyMs: 20,
    accepts: RW, emits: S(false, false, true), routing: "cascade", tierPriority: 3,
    readCost: 1, writeCost: 3, replCost: 0, shipCost: 0.15, writePriority: true, tag: "store",
  },
  REPLICA: {
    id: "REPLICA", cost: 100, capacity: 3000, baseLatencyMs: 20,
    accepts: S(true, false, true), emits: NONE, routing: "cascade", tierPriority: 2,
    readCost: 1, writeCost: 1, replCost: 0.4, shipCost: 0, replicaLagBaseMs: 40, tag: "store",
  },
  QUEUE: {
    id: "QUEUE", cost: 70, capacity: 50000, baseLatencyMs: 5,
    accepts: S(false, true), emits: S(false, true), routing: "cascade", tierPriority: 4,
    readCost: 1, writeCost: 1, replCost: 0, shipCost: 0, queueMaxDepth: 20000, tag: "async",
  },
  WORKER: {
    id: "WORKER", cost: 60, capacity: 1800, baseLatencyMs: 35,
    accepts: S(false, true), emits: S(false, true), routing: "cascade", tierPriority: 5,
    readCost: 1, writeCost: 1, replCost: 0, shipCost: 0, tag: "compute",
  },
  RATELIMIT: {
    id: "RATELIMIT", cost: 40, capacity: 100000, baseLatencyMs: 2,
    accepts: RW, emits: RW, routing: "cascade", tierPriority: 5,
    readCost: 1, writeCost: 1, replCost: 0, shipCost: 0, shedRate: 0.25, tag: "policy",
  },
};

export const RULES_VERSION = "rules-0.2.0";

export const RULESET: Ruleset = {
  version: RULES_VERSION,
  parts: PARTS,
  constants: {
    utilCap: 0.97, latCapMul: 14, invalCap: 0.8, spillUtil: 0.9,
    breakerTrip: 0.5, maxIterations: 150, tolerance: 1e-4, maxBuckets: 48, replLagCapMul: 14, retryCorrelation: 0.7, cacheWarmupSec: 20,
  },
  damage: { writeWeight: 4, dataLossWeight: 12, staleWeight: 0.5 },
};
