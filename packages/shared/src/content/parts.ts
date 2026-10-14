import type { PartId } from "@sysd/sim";

/**
 * Plain-language text for every component. Written for someone who has never designed a system.
 * RULES for all user-facing copy in this package (enforced by a test): no abbreviations, no
 * acronyms, no jargon without an explanation. Say "load balancer", never "LB".
 */
export interface PartInfo {
  /** the full name shown everywhere, including inside the game canvas */
  readonly fullName: string;
  /** one sentence: what is it? */
  readonly summary: string;
  /** an everyday comparison */
  readonly analogy: string;
  /** when is it worth buying? */
  readonly useWhen: string;
  /** the catch */
  readonly watchOut: string;
}

export const PART_INFO: Readonly<Record<PartId, PartInfo>> = {
  CLIENT: {
    fullName: "Visitors",
    summary: "The people using your service. Every request in the game starts with them.",
    analogy: "The crowd outside a shop, waiting to come in.",
    useWhen: "You always have exactly one. Connect it to the first piece your requests should reach.",
    watchOut: "You cannot remove it, and it never breaks. It only shows where the traffic comes from.",
  },
  LB: {
    fullName: "Load balancer",
    summary: "Splits incoming requests evenly across several application servers so none of them is overwhelmed.",
    analogy: "A host at a restaurant who sends each new group of guests to a different waiter.",
    useWhen: "You have two or more application servers and want them to share the work.",
    watchOut: "It stores nothing and answers nothing itself. It cannot help if the database is the slow part.",
  },
  APP: {
    fullName: "Application server",
    summary: "The workers that handle each request: they check what was asked, look things up, and send back the answer.",
    analogy: "Cashiers at a supermarket. More cashiers means a shorter line.",
    useWhen: "Your servers are running close to full, or a traffic spike would overload them.",
    watchOut: "Each one can only do so much work per second. Saving data costs them a little more effort than reading it.",
  },
  CACHE: {
    fullName: "Cache",
    summary: "A small, very fast memory that remembers recent answers, so the database does not have to look them up again.",
    analogy: "A sticky note on your desk with the phone numbers you call most often.",
    useWhen: "Most requests ask for the same few things, like popular short links.",
    watchOut: "If it is emptied, every request suddenly goes to the database at once. It only helps with reading, never with saving.",
  },
  CDN: {
    fullName: "Content delivery network",
    summary: "Keeps copies of popular answers in many places close to visitors, so most requests never reach your own servers.",
    analogy: "Local corner shops stocked with the best sellers, so people do not drive to the warehouse.",
    useWhen: "A huge number of visitors keep asking for the same things.",
    watchOut: "It only helps with looking things up, not with saving new links. Writing new data can make its copies stale.",
  },
  DB: {
    fullName: "Database",
    summary: "The permanent record. Every short link is saved here so nothing is ever lost.",
    analogy: "A filing cabinet. Reliable, but slower than keeping something in your head.",
    useWhen: "You always need one. Without it, new links cannot be saved at all.",
    watchOut: "It is slow and expensive compared with memory. If you only have one and it breaks, everything stops.",
  },
  REPLICA: {
    fullName: "Read replica",
    summary: "A live copy of the database that only answers lookups. Extra copies share the reading work and keep working if the main database fails.",
    analogy: "Photocopies of the busiest drawers of the filing cabinet, kept beside the original.",
    useWhen: "Lookups overwhelm the database, or you want a spare in case the main one crashes.",
    watchOut: "Copies can lag slightly behind the original, and keeping them updated costs the main database some effort.",
  },
  QUEUE: {
    fullName: "Waiting line for new work",
    summary: "Visitors get an instant \"received\" while the actual saving happens a moment later, so a rush of new links does not slow anyone down.",
    analogy: "A ticket window with an orderly line behind it, instead of everyone crowding the counter.",
    useWhen: "Many people might save new links at the same time.",
    watchOut: "If the line grows faster than the workers clear it, it eventually overflows and the oldest work is lost. It also needs a background worker.",
  },
  WORKER: {
    fullName: "Background worker",
    summary: "Takes jobs off the waiting line one by one and finishes them. Here, it saves new links into the database.",
    analogy: "The person behind the ticket window who processes each ticket.",
    useWhen: "You have a waiting line and need something to empty it.",
    watchOut: "It does nothing without a waiting line in front of it, and the database still has to keep up with it.",
  },
  RATELIMIT: {
    fullName: "Rate limiter",
    summary: "Turns away some requests when too many arrive. It exists to stop abusers and automated floods.",
    analogy: "A bouncer who only lets a fixed number of people in per minute.",
    useWhen: "You are being flooded by abusive or automated traffic.",
    watchOut: "It cannot tell a rush of real visitors from abuse, so it turns real people away too. It does not add capacity.",
  },
};

export const fullName = (id: PartId): string => PART_INFO[id].fullName;
