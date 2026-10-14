import type { PartId } from "@sysd/sim";
import type { WaveKind } from "./types.js";

/**
 * The rewards. Three kinds: new pieces to build with, boosts that last the whole run, and money.
 * `helps` says which kinds of wave the upgrade answers, so the reward screen can point at the one that matters next.
 */
export interface Upgrade {
  readonly id: string;
  readonly kind: "piece" | "boost" | "money";
  readonly name: string;
  readonly text: string;
  readonly helps: readonly WaveKind[];
  readonly unlocks?: readonly PartId[];
}

export const UPGRADES: readonly Upgrade[] = [
  { id: "p-cdn", kind: "piece", name: "Content delivery network", text: "Unlocks a piece that keeps copies of popular answers close to visitors. It takes a huge share of the reading off your servers.", helps: ["viral", "boss"], unlocks: ["CDN"] },
  { id: "p-replica", kind: "piece", name: "Database copies", text: "Unlocks a live copy of your database that answers lookups, so the original does not do all the reading.", helps: ["crawler", "saving", "boss"], unlocks: ["REPLICA"] },
  { id: "p-queue", kind: "piece", name: "Waiting line and worker", text: "Unlocks a waiting line and a background worker. A rush of saving waits in line and is finished a moment later.", helps: ["saving"], unlocks: ["QUEUE", "WORKER"] },
  { id: "p-limiter", kind: "piece", name: "Rate limiter", text: "Unlocks a gate that turns away automated programs, and almost never real people.", helps: ["bots"], unlocks: ["RATELIMIT"] },
  { id: "b-servers", kind: "boost", name: "Stronger servers", text: "Every application server can handle 30 percent more.", helps: ["busy", "slow", "boss"] },
  { id: "b-cache", kind: "boost", name: "Bigger memory", text: "Every cache remembers more, so it answers 20 percent more of the lookups.", helps: ["viral", "busy"] },
  { id: "b-refill", kind: "boost", name: "Quick refill", text: "A cache that gets emptied refills twice as fast.", helps: ["boss"] },
  { id: "b-database", kind: "boost", name: "Stronger database", text: "Your database and its copies can handle 40 percent more.", helps: ["crawler", "saving", "boss"] },
  { id: "b-breaker", kind: "boost", name: "Safety switch", text: "When a piece starts failing, your servers stop retrying and let it recover instead of piling on.", helps: ["boss", "busy", "slow"] },
  { id: "b-retry", kind: "boost", name: "Try once, not twice", text: "Failed requests are tried again only once, so a struggling piece gets less extra work.", helps: ["busy", "slow"] },
  { id: "b-cheap", kind: "boost", name: "Bulk discount", text: "Everything you buy from now on costs 15 percent less.", helps: [] },
  { id: "m-cash", kind: "money", name: "A generous sponsor", text: "You receive $150 right now.", helps: [] },
  { id: "m-income", kind: "money", name: "More visitors, more income", text: "You earn 25 percent more after every wave.", helps: [] },
];

export const upgradeById = (id: string): Upgrade | undefined => UPGRADES.find((u) => u.id === id);

export const STARTER_PARTS: readonly PartId[] = ["LB", "APP", "CACHE", "DB"];
