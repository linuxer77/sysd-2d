import type { AttackId } from "../attacks.js";

export interface AttackInfo {
  readonly fullName: string;
  /** what happens, in one or two plain sentences */
  readonly whatHappens: string;
  /** the real-world situation it represents */
  readonly realWorld: string;
  /** what protects you */
  readonly howToDefend: string;
}

export const ATTACK_INFO: Readonly<Record<AttackId, AttackInfo>> = {
  SPIKE: {
    fullName: "Traffic spike",
    whatHappens: "A sudden crowd arrives. For 30 seconds there are 1.8 times more visitors than usual.",
    realWorld: "A link goes viral on social media and everyone clicks it at once.",
    howToDefend: "More application servers, caches that answer most requests without touching the database, and a circuit breaker so retries do not pile on.",
  },
  FLUSH: {
    fullName: "Cache wipe",
    whatHappens: "Every cache is emptied. Until it refills, requests that the cache would have answered must go all the way to the database.",
    realWorld: "A cache server restarts after an update and comes back empty.",
    howToDefend: "Make sure your database can survive a rush without the cache. Two layers of caching help, because the second layer catches what the first one drops.",
  },
  KILL: {
    fullName: "Server crash",
    whatHappens: "One component, chosen by the attacker, stops working completely for two rounds.",
    realWorld: "A machine loses power or a software bug brings one piece down.",
    howToDefend: "Keep spares of the important pieces, such as a second application server or a read replica, so losing one does not stop everything.",
  },
  LAG: {
    fullName: "Slow database",
    whatHappens: "Everything that stores data becomes 140 milliseconds slower for two rounds.",
    realWorld: "The database is busy with a large background job, or the network to it is struggling.",
    howToDefend: "Caches hide a slow database from visitors. Sensible timeouts and a circuit breaker stop slow answers from turning into a retry storm.",
  },
  WRITE_STORM: {
    fullName: "Burst of new links",
    whatHappens: "Eight times more people than usual try to save a new link at the same moment.",
    realWorld: "A marketing campaign launches and thousands of people create links together.",
    howToDefend: "A waiting line with background workers soaks up the rush and lets visitors continue immediately.",
  },
};

export interface OperationInfo { readonly fullName: string; readonly whatHappens: string; readonly whenToUse: string }

export const OPERATION_INFO = {
  FAILOVER: {
    fullName: "Switch to backups",
    whatHappens: "Brings back every component that has crashed.",
    whenToUse: "Right after a server crash, if you have something worth reviving.",
  },
  SCALE: {
    fullName: "Add capacity",
    whatHappens: "Every component can handle 60 percent more work for two rounds.",
    whenToUse: "When the warning says a crowd or a burst of work is coming.",
  },
  SHED: {
    fullName: "Turn some visitors away",
    whatHappens: "Deliberately drops 40 percent of visitors so the rest are served properly. It costs you 6 health.",
    whenToUse: "Only when the alternative is a total collapse. Turning visitors away always counts as failing them.",
  },
} as const satisfies Record<string, OperationInfo>;
