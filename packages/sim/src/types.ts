/**
 * The entire domain model. Everything is deeply readonly: the engine never
 * mutates its inputs, and builds its own working state inside compile().
 *
 * NOTE: a Design carries NO coordinates. Layout is a sibling concern owned by
 * the UI/transport layer, so the sim provably cannot read it.
 */

export type NodeId = string;

export type PartId =
  | "CLIENT" | "LB" | "APP" | "CACHE" | "CDN"
  | "DB" | "REPLICA" | "QUEUE" | "WORKER" | "RATELIMIT";

export type TrafficClass = "read" | "write" | "repl";
export type RoutingMode = "cascade" | "balance";
export type PartTag = "entry" | "edge" | "compute" | "cache" | "store" | "async" | "policy";

export interface ClassSet {
  readonly read: boolean;
  readonly write: boolean;
  readonly repl: boolean;
}

export interface PartDef {
  readonly id: PartId;
  readonly cost: number;
  /** capacity units per second */
  readonly capacity: number;
  readonly baseLatencyMs: number;
  readonly accepts: ClassSet;
  readonly emits: ClassSet;
  readonly routing: RoutingMode;
  /** cascade ordering: lower = tried first (cache 0, cdn 1, replica 2, store 3, queue 4, compute 5) */
  readonly tierPriority: number;
  readonly readCost: number;
  readonly writeCost: number;
  /** capacity a replica burns applying one replicated write */
  readonly replCost: number;
  /** capacity a primary burns shipping one write to ONE replica */
  readonly shipCost: number;
  readonly hitRate?: number;
  /** how strongly write traffic erodes this cache's hit rate */
  readonly invalidationSensitivity?: number;
  readonly shedRate?: number;
  /** under overload, shed reads before writes (durability first) */
  readonly writePriority?: boolean;
  readonly queueMaxDepth?: number;
  readonly replicaLagBaseMs?: number;
  readonly tag: PartTag;
}

export interface SimConstants {
  readonly utilCap: number;       // queueing model saturates here
  readonly latCapMul: number;     // max latency multiplier from queueing
  readonly invalCap: number;      // max hit-rate erosion from writes
  readonly spillUtil: number;     // cascade spills to the next tier above this util
  readonly breakerTrip: number;   // attempt-failure fraction that opens the breaker
  readonly maxIterations: number; // relaxation cap; exits early once the residual < tolerance
  readonly tolerance: number;     // deterministic: same inputs => same exit iteration, on every machine
  readonly maxBuckets: number;    // latency histogram bound
  readonly replLagCapMul: number;
  /** P(a retry fails | the previous attempt failed) = rho + (1-rho)*p. 0 = independent re-rolls. */
  readonly retryCorrelation: number;
  /** seconds for a flushed cache to refill; hit rate ramps linearly 0 -> full over this window */
  readonly cacheWarmupSec: number;
}

export interface DamageRules {
  readonly writeWeight: number;     // a bad write costs this many bad reads
  readonly dataLossWeight: number;  // a lost/duplicated write
  readonly staleWeight: number;
}

export interface Ruleset {
  readonly version: string;
  readonly parts: Readonly<Record<PartId, PartDef>>;
  readonly constants: SimConstants;
  readonly damage: DamageRules;
}

export interface Scenario {
  readonly id: string;
  /** steady-state peak offered load, requests/sec, before any attack */
  readonly rps: number;
  /** fraction of requests that are writes */
  readonly writeRatio: number;
  readonly sloP99Ms: number;
  readonly writeSloP99Ms: number;
  readonly consistencySloMs: number;
  readonly budget: number;
  readonly roundSeconds: number;
  /** bad requests an error budget allows; damage% = bad / this * 100 */
  readonly errorBudgetRequests: number;
}

export interface Policy {
  readonly readTimeoutMs: number;
  readonly writeTimeoutMs: number;
  readonly retries: number;
  readonly breaker: boolean;
  /** cap on retry-induced extra load, as % of base load */
  readonly retryBudgetPct: number;
  readonly idempotentWrites: boolean;
}

export interface DesignNode { readonly id: NodeId; readonly part: PartId }
export interface DesignEdge {
  readonly from: NodeId;
  readonly to: NodeId;
  /** narrows (never widens) which classes the edge carries */
  readonly pin?: "read" | "write";
}
export interface Design {
  readonly nodes: readonly DesignNode[];
  readonly edges: readonly DesignEdge[];
  readonly policy: Policy;
}

export interface Mods {
  readonly killed: readonly NodeId[];
  readonly spikeMul: number;
  readonly writeSpikeMul: number;
  readonly flush: boolean;
  readonly latencyAddMs: Readonly<Record<string, number>>; // keyed by PartId or NodeId
  readonly capMul: number;
  readonly shedFrac: number;
  readonly durationSec: number;
  /** All optional, and each default changes nothing, so older callers and every golden snapshot are untouched. */
  /** share of reads that no cache or content delivery network can answer (links nobody asked for before) */
  readonly uniqueReadFrac?: number;
  /** extra cache hit share, as a fraction of the normal rate (the same few links, over and over) */
  readonly hitBoost?: number;
  /** extra reads per second that are automated programs, not visitors */
  readonly botRps?: number;
  /** share of bots a part removes, keyed by part id (a rate limiter that tells bots from people) */
  readonly botBlock?: Readonly<Record<string, number>>;
  /** capacity multiplier per part id (slow visitors tie up servers; upgrades make them bigger) */
  readonly partCapMul?: Readonly<Record<string, number>>;
  /** scales how long a wiped cache takes to refill (below 1 is faster) */
  readonly warmupMul?: number;
}

export interface SimCarry {
  readonly queueDepth: Readonly<Record<NodeId, number>>;
}

export interface SimInput {
  readonly design: Design;
  readonly ruleset: Ruleset;
  readonly scenario: Scenario;
  readonly mods: Mods;
  readonly carry: SimCarry;
}

export interface ClassResult {
  readonly offered: number;       // base requests/sec, retries excluded
  readonly attempts: number;      // incl. retry amplification
  readonly dropped: number;       // attempts/sec dropped
  readonly attemptFail: number;   // fraction of attempts dropped or timed out
  readonly userFail: number;      // fraction of USER requests that fail after retries
  readonly slowFrac: number;      // fraction of successes slower than the SLO
  readonly badFrac: number;       // userFail + slow successes
  readonly p50Ms: number;
  readonly p99Ms: number;
  readonly amplification: number;
  readonly timedOutFrac: number;
}

export interface NodeResult {
  readonly id: NodeId;
  readonly part: PartId;
  readonly dead: boolean;
  readonly loadR: number;
  readonly loadW: number;
  readonly util: number;
  readonly latMs: number;
  readonly dropped: number;
}

export type FindingCode =
  | "retry-storm" | "breaker-tripped" | "thundering-herd" | "saturated-node"
  | "dead-node" | "queue-overflow" | "slo-breach" | "stale-reads"
  | "duplicate-writes" | "no-cache" | "single-store" | "limiter-drops-users";

export interface Finding {
  readonly code: FindingCode;
  readonly severity: "info" | "warn" | "bad";
  readonly nodeId?: NodeId;
  readonly value?: number;
}

export interface SimResult {
  readonly read: ClassResult;
  readonly write: ClassResult;
  readonly consistency: {
    readonly stalenessMs: number;
    readonly lostWrites: number;
    readonly duplicateWrites: number;
    readonly queueDepth: number;
    readonly replicaReadRps: number;
  };
  readonly nodes: readonly NodeResult[];
  readonly findings: readonly Finding[];
  readonly breakerTripped: boolean;
}

export interface SimOutput {
  readonly result: SimResult;
  readonly carry: SimCarry;
}

/** Developer-facing. Players never see `message`: the coach turns `code` into plain language. */
export interface Issue {
  readonly severity: "error" | "warn";
  readonly code: string;
  readonly message: string;
  readonly nodeId?: NodeId;
}

export interface DamageBreakdown {
  readonly total: number;
  readonly availability: number;
  readonly latency: number;
  readonly writes: number;
  readonly dataLoss: number;
  readonly staleness: number;
}
