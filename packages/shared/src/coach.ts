import {
  NO_CARRY, compile, damage, simulate,
  type Design, type NodeId, type PartId, type Ruleset, type Scenario, type SimResult,
} from "@sysd/sim";
import { applyAttack, baseMods } from "./attacks.js";
import { PART_INFO } from "./content/parts.js";

export type TipKind = "problem" | "warning" | "idea" | "good";
export interface CoachTip {
  readonly id: string;
  readonly kind: TipKind;
  readonly title: string;
  /** plain-language explanation: what is wrong and why it matters */
  readonly body: string;
  /** a concrete next step */
  readonly tryThis?: string;
  readonly nodeId?: NodeId;
}

const nm = (p: PartId): string => PART_INFO[p].fullName;
const lower = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);
const pct = (x: number): number => Math.round(x * 100);
/** "17,800": rounded to the nearest hundred, with a thousands separator. No locale APIs needed. */
const about = (n: number): string => {
  const r = Math.max(0, Math.round(n / 100) * 100);
  return r >= 1000 ? String(Math.floor(r / 1000)) + "," + String(r % 1000).padStart(3, "0") : String(r);
};
const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

const run = (d: Design, r: Ruleset, s: Scenario, attacks: ("SPIKE" | "FLUSH" | "KILL" | "LAG" | "WRITE_STORM")[], target?: NodeId): SimResult => {
  let m = baseMods(s.roundSeconds);
  for (const a of attacks) m = applyAttack(m, a, target);
  return simulate({ design: d, ruleset: r, scenario: s, mods: m, carry: NO_CARRY }).result;
};

/**
 * Reads the design and the real simulation, and explains in plain words what is wrong,
 * what is risky, and what to try next. Pure: same design, same advice.
 */
export function coach(design: Design, ruleset: Ruleset, scenario: Scenario): readonly CoachTip[] {
  const tips: CoachTip[] = [];
  const c = compile(design, ruleset);
  const has = (p: PartId): boolean => design.nodes.some((n) => n.part === p);
  const count = (p: PartId): number => design.nodes.filter((n) => n.part === p).length;
  const spent = design.nodes.reduce((s, n) => s + ruleset.parts[n.part].cost, 0);

  // ----- the design cannot even run yet
  for (const i of c.issues) {
    if (i.code === "cycle") tips.push({ id: "cycle", kind: "problem", title: "Your lines form a loop",
      body: "A request would travel around and around forever. Requests need to flow one way: from the visitors, through your pieces, and finally to a database.",
      tryThis: "Click a line between two pieces to remove it, so everything points away from the visitors." });
    if (i.code === "client-count") tips.push({ id: "client", kind: "problem", title: "The visitors are missing",
      body: "Every design starts with exactly one group of visitors. They are where all the requests come from." });
    if (i.code === "dead-link") tips.push({ id: "dead-" + (i.nodeId ?? ""), kind: "warning", title: "One of your lines does nothing",
      body: "These two pieces cannot pass requests to each other. For example, a database does not send requests onward, and a cache cannot accept new links to save.",
      tryThis: "Remove that line and connect the pieces in a different order.", ...(i.nodeId ? { nodeId: i.nodeId } : {}) });
    if (i.code === "replica-no-primary") tips.push({ id: "replica-orphan", kind: "warning", title: "A read replica is not connected to a database",
      body: "A read replica is a live copy of the database, so it must be connected from one. Right now it has nothing to copy, so it will not be used.",
      tryThis: "Draw a line from your database to the read replica.", ...(i.nodeId ? { nodeId: i.nodeId } : {}) });
    if (i.code === "queue-no-worker") tips.push({ id: "queue-orphan", kind: "warning", title: "Nothing empties your waiting line",
      body: "A waiting line only holds work. Without a background worker taking jobs off it, new links would pile up and never be saved.",
      tryThis: "Add a background worker, then connect the waiting line to it, and the worker to your database.", ...(i.nodeId ? { nodeId: i.nodeId } : {}) });
    if (i.code === "cache-no-origin") tips.push({ id: "cache-orphan", kind: "warning", title: "A cache has nowhere to send what it does not know",
      body: "A cache only remembers some answers. For everything else, it has to ask the database. Right now it is not connected to one, so those requests fail.",
      tryThis: "Draw a line from the cache to your database.", ...(i.nodeId ? { nodeId: i.nodeId } : {}) });
    if (i.code === "unreachable") tips.push({ id: "unreachable-" + (i.nodeId ?? ""), kind: "warning", title: "A piece is not connected to the visitors",
      body: "No request can ever reach it, so you are paying for something that does nothing.",
      tryThis: "Connect it, or remove it to get its money back.", ...(i.nodeId ? { nodeId: i.nodeId } : {}) });
  }
  if (!c.ok) {
    if (!tips.length) tips.push({ id: "invalid", kind: "problem", title: "This design cannot run yet", body: "Something about the way these pieces are connected is not valid. Check the lines between them." });
    return tips;
  }

  if (spent > scenario.budget)
    tips.push({ id: "budget", kind: "problem", title: "You are over budget",
      body: `You have spent $${spent} but your budget is $${scenario.budget}. A design over budget cannot be locked in.`,
      tryThis: "Remove the piece that is helping least, or swap an expensive piece for a cheaper one." });

  if (!has("DB")) {
    tips.push({ id: "no-db", kind: "problem", title: "There is nowhere to save links",
      body: "Every short link has to be kept somewhere permanent. Without a database, new links vanish and lookups find nothing.",
      tryThis: "Add a database and connect your application servers to it." });
    return tips;
  }
  if (design.edges.length === 0) {
    tips.push({ id: "no-links", kind: "idea", title: "Start by connecting the visitors",
      body: "Requests travel along the lines you draw. Click the visitors, then click the first piece they should reach, such as an application server.",
      tryThis: "Visitors, then application server, then database is a working starting point." });
    return tips;
  }

  // ----- how it behaves under normal traffic
  const calm = run(design, ruleset, scenario, []);
  // "cannot work at all" (no path to a database) is different from "overloaded at peak". Judge the first at
  // trivial traffic, so a one-server design is never told its links cannot be saved when it is merely too small.
  const light = run(design, ruleset, { ...scenario, rps: 20 }, []);
  const bottleneck = [...calm.nodes].filter((n) => !n.dead && n.part !== "CLIENT").sort((a, b) => b.util - a.util)[0];

  if (light.write.userFail > 0.5)
    tips.push({ id: "writes-fail", kind: "problem", title: "New links cannot be saved",
      body: "Requests to create a link are not reaching your database. Saving needs a path from the visitors, through your application servers, to the database.",
      tryThis: "Check that an application server is connected to your database." });
  if (light.read.userFail > 0.5 && light.write.userFail <= 0.5)
    tips.push({ id: "reads-fail", kind: "problem", title: "Visitors cannot open short links",
      body: "Lookups are failing even with normal traffic. They are either not reaching a place that can answer, or the place they reach is far too small.",
      tryThis: "Make sure there is a path from the visitors to something that can answer lookups, and that it has enough capacity." });

  const reqs = calm.read.offered + calm.write.offered;
  const attempts = calm.read.attempts + calm.write.attempts;
  if (calm.read.amplification > 1.15 || calm.write.amplification > 1.15)
    tips.push({ id: "retry-storm", kind: "problem", title: "Retries are multiplying your traffic",
      body: `Your visitors try again whenever a request fails, so about ${about(reqs)} requests per second has turned into about ${about(attempts)}. All that extra work makes even more requests fail, which causes even more retries. This is called a retry storm, and it can bring down a system that would otherwise cope.`,
      tryThis: "Turn on the circuit breaker in the policy panel, or lower the number of retries. Adding capacity helps too, because fewer requests fail in the first place." });

  if (bottleneck && bottleneck.util > 1) {
    tips.push({ id: "bottleneck", kind: "problem", nodeId: bottleneck.id, title: `The ${lower(nm(bottleneck.part))} is the bottleneck`,
      body: `It is ${pct(bottleneck.util)} percent full under normal traffic, so it is turning requests away. A system can only go as fast as its smallest piece.`,
      tryThis: bottleneckAdvice(bottleneck.part) });
  } else if (bottleneck && bottleneck.util > 0.8) {
    tips.push({ id: "tight", kind: "warning", nodeId: bottleneck.id, title: `The ${lower(nm(bottleneck.part))} is nearly full`,
      body: `It is ${pct(bottleneck.util)} percent full under normal traffic. That works today, but any extra crowd will overwhelm it.`,
      tryThis: bottleneckAdvice(bottleneck.part) });
  }

  if (calm.read.p99Ms > scenario.sloP99Ms && calm.read.userFail < 0.5)
    tips.push({ id: "slow", kind: "problem", title: "Lookups are too slow",
      body: `The slowest 1 in 100 visitors waits about ${Math.round(calm.read.p99Ms)} milliseconds. Your goal is under ${scenario.sloP99Ms}. Slow answers count as failures, so they spend your health.`,
      tryThis: "Put a cache in front of the database. Answers from memory are far faster than asking the database." });

  // ----- structural advice
  const caches = count("CACHE") + count("CDN");
  if (caches === 0)
    tips.push({ id: "no-cache", kind: "idea", title: "Every lookup is going to the database",
      body: "About 100 out of every 101 requests only read information that does not change. A cache can answer most of them straight from fast memory.",
      tryThis: "Add a cache, connect your application servers to it, and connect the cache to your database." });

  const stores = count("DB") + count("REPLICA");
  if (stores === 1)
    tips.push({ id: "single-db", kind: "idea", title: "One crash would stop everything",
      body: "You have a single database. If it crashes, nothing can be saved and nothing can be looked up. This is called a single point of failure.",
      tryThis: "A read replica is a live copy that keeps answering lookups even if the main database goes down." });

  if (count("APP") === 1 && !has("LB"))
    tips.push({ id: "single-app", kind: "idea", title: "You have only one application server",
      body: "It handles every request, and if it crashes your service is gone.",
      tryThis: "Add a second application server and put a load balancer in front of them to share the work." });

  if (design.policy.retries > 0 && !design.policy.breaker)
    tips.push({ id: "retries-no-breaker", kind: "warning", title: "Retries without a circuit breaker can make things worse",
      body: `Your visitors retry up to ${design.policy.retries} ${plural(design.policy.retries, "time", "times")} when something fails. That is fine when failures are rare. During an overload, every retry adds more work, which causes more failures, which causes more retries. This is called a retry storm.`,
      tryThis: "Turn on the circuit breaker in the policy panel. It stops retries when too many requests are failing, which gives your system room to recover." });

  if (has("RATELIMIT"))
    tips.push({ id: "limiter", kind: "warning", title: "The rate limiter will turn away real visitors",
      body: "A rate limiter is built to stop abusive traffic, but it cannot tell a rush of real people from abuse. Under normal load it still rejects a share of your visitors, and each rejected visitor spends your health.",
      tryThis: "Unless you are being flooded by abusive traffic, you will usually do better spending that money on capacity." });

  if (has("QUEUE") && has("WORKER") === false)
    tips.push({ id: "queue-worker", kind: "problem", title: "The waiting line has no worker", body: "Work will pile up and never be saved.", tryThis: "Add a background worker." });

  // ----- stress tests: what an attacker would find
  const spike = damage(run(design, ruleset, scenario, ["SPIKE"]), scenario, ruleset, scenario.roundSeconds).total;
  const flushed = damage(run(design, ruleset, scenario, ["FLUSH"]), scenario, ruleset, scenario.roundSeconds).total;
  if (calm.read.userFail <= 0.5) {
    if (spike >= 15)
      tips.push({ id: "spike-weak", kind: "warning", title: "A sudden crowd would hurt",
        body: `If 1.8 times more visitors arrived, you would lose about ${Math.round(spike)} of your 100 health in a single round. An opponent will try exactly this.`,
        tryThis: "More application servers, a second layer of caching, or a circuit breaker all help. Press the test button to try it and see which piece fills up first." });
    if (flushed >= 15 && caches > 0)
      tips.push({ id: "flush-weak", kind: "warning", title: "Wiping your cache would hurt",
        body: `Your cache is hiding a database that is too small to cope without it. If the cache were emptied, you would lose about ${Math.round(flushed)} health.`,
        tryThis: "Give the database more help, such as a read replica, or add a second layer of caching." });
  }

  if (tips.every((t) => t.kind !== "problem" && t.kind !== "warning") && calm.read.userFail < 0.05 && spike < 15)
    tips.unshift({ id: "solid", kind: "good", title: "This is a solid design",
      body: `Under normal traffic nothing is turned away, and a sudden crowd would cost you only about ${Math.round(spike)} health. Try the attacks yourself to find the weak spots an opponent would look for.`,
      tryThis: "Press the test button and try the cache wipe, then the server crash." });

  const order: Record<TipKind, number> = { problem: 0, warning: 1, idea: 2, good: 3 };
  return tips.map((t, i) => ({ t, i })).sort((a, b) => order[a.t.kind] - order[b.t.kind] || a.i - b.i).map((x) => x.t);
}

function bottleneckAdvice(p: PartId): string {
  switch (p) {
    case "APP": return "Add another application server, and connect a load balancer in front of them so they share the work.";
    case "DB": return "Put a cache in front of the database so it receives far fewer requests, or add a read replica to share the lookups.";
    case "REPLICA": return "Add a second read replica, or a cache in front of it, so each one has less to answer.";
    case "WORKER": return "Add another background worker so the waiting line empties faster.";
    case "LB": return "A load balancer rarely runs out of room. Check what is connected after it.";
    default: return "Add more capacity at this point in the chain, or reduce how many requests reach it.";
  }
}
