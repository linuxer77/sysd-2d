import {
  NO_CARRY, damage, simulate, type Design, type NodeId, type Ruleset, type Scenario, type SimResult,
} from "@sysd/sim";
import { applyAttack, baseMods, type AttackId } from "./attacks.js";

/**
 * A guided first game. Each step teaches one idea, tells the player exactly what to do in plain
 * words, and is checked against the REAL simulator, so "done" always means it genuinely works.
 */
export interface MissionContext { readonly ruleset: Ruleset; readonly scenario: Scenario }
export interface MissionCheck { readonly done: boolean; readonly progress: string }
export interface MissionStep {
  readonly id: string;
  readonly title: string;
  /** the ONE thing to do, in a single short line. This is what the player sees first. */
  readonly short: string;
  /** one or two sentences of context: why are we doing this? */
  readonly story: string;
  /** numbered, concrete actions */
  readonly task: readonly string[];
  /** the idea this step teaches */
  readonly lesson: string;
  readonly check: (d: Design, ctx: MissionContext) => MissionCheck;
}

const sim = (d: Design, ctx: MissionContext, attacks: AttackId[] = [], target?: NodeId): { r: SimResult; dmg: number } => {
  let m = baseMods(ctx.scenario.roundSeconds);
  for (const a of attacks) m = applyAttack(m, a, target);
  const r = simulate({ design: d, ruleset: ctx.ruleset, scenario: ctx.scenario, mods: m, carry: NO_CARRY }).result;
  return { r, dmg: damage(r, ctx.scenario, ctx.ruleset, m.durationSec).total };
};

const firstOf = (d: Design, part: string): NodeId | undefined => [...d.nodes].filter((n) => n.part === part).sort((a, b) => (a.id < b.id ? -1 : 1))[0]?.id;

export const LINKSMASH_MISSIONS: readonly MissionStep[] = [
  {
    id: "make-it-work",
    title: "Make short links work",
    short: "Connect the visitors to an application server, and the server to a database.",
    story: "Before anything else, your service has to do its basic job: save a new link, and open an existing one.",
    task: [
      "Drag an application server onto the board.",
      "Drag a database onto the board.",
      "Click the visitors, then click the application server, to connect them.",
      "Click the application server, then click the database, to connect those too.",
    ],
    lesson: "Requests flow along your lines, starting at the visitors. Everything that saves data ends at a database.",
    check: (d, ctx) => {
      // Step one is about CONNECTING things, so judge it at light traffic. A first design with one
      // server is not expected to survive a busy day yet; that is what the next steps are for.
      const { r } = sim(d, { ...ctx, scenario: { ...ctx.scenario, rps: 20 } });
      const saves = r.write.userFail < 0.05, opens = r.read.userFail < 0.95;
      return {
        done: saves && opens,
        progress: saves && opens ? "Links can be saved and opened." : saves ? "Saving works, but opening links does not yet." : opens ? "Opening works, but new links cannot be saved yet." : "Nothing works yet. Connect the visitors to an application server, and that server to a database.",
      };
    },
  },
  {
    id: "keep-up",
    title: "Keep up with a normal day",
    short: "Add a cache between the server and the database. Make nothing turn red.",
    story: "Your first version works, but one database answering every single lookup will be overwhelmed. Look at how full each piece is.",
    task: [
      "Add a cache. A cache remembers popular answers in fast memory, so the database is asked far less often.",
      "Connect the application server to the cache, and the cache to the database.",
      "If any piece is more than 80 percent full, add another of that piece. A load balancer in front of several application servers shares the work between them.",
    ],
    lesson: "Most requests ask for the same few things, so remembering answers is much cheaper than looking them up again.",
    check: (d, ctx) => {
      const { r, dmg } = sim(d, ctx);
      const slow = r.read.p99Ms > ctx.scenario.sloP99Ms;
      return {
        done: dmg === 0,
        progress: dmg === 0 ? "A normal day passes with nobody turned away and nobody kept waiting." :
          r.read.userFail > 0.02 ? "Some visitors are being turned away. Find the piece that is more than 100 percent full." :
          slow ? `The slowest 1 in 100 visitors waits ${Math.round(r.read.p99Ms)} milliseconds. The goal is under ${ctx.scenario.sloP99Ms}.` : "Almost there. A few requests are still failing.",
      };
    },
  },
  {
    id: "survive-crowd",
    title: "Survive a sudden crowd",
    short: "Test the traffic spike. Add servers or a second cache until it barely hurts.",
    story: "Your link just went viral. For 30 seconds, 1.8 times more people arrive than usual. This is exactly what your opponent will try to do to you.",
    task: [
      "Press the test button and choose traffic spike to see which piece fills up first.",
      "Add capacity where it fills up: more application servers, or a second layer of caching.",
      "Look at the policy panel. If visitors retry failures, turn on the circuit breaker so retries cannot pile on during an overload.",
    ],
    lesson: "Systems fail at their weakest point under pressure. Retries can turn a small problem into a collapse unless something stops them.",
    check: (d, ctx) => {
      const { dmg } = sim(d, ctx, ["SPIKE"]);
      return { done: dmg < 10, progress: dmg < 10 ? `A sudden crowd costs you only ${Math.round(dmg)} health. That is easily survivable.` : `A sudden crowd would cost you ${Math.round(dmg)} health. Aim for under 10.` };
    },
  },
  {
    id: "survive-crash",
    title: "Survive a crash",
    short: "Test the server crash on your database. Add a read replica so lookups keep working.",
    story: "Machines fail. Your opponent can crash a piece of your service on purpose. If one crash stops everything, you lose quickly.",
    task: [
      "Press the test button and choose server crash, then pick your database.",
      "If your visitors lose most of their service, add a read replica. It is a live copy of the database that keeps answering lookups.",
      "Connect the database to the read replica, and the cache to the read replica.",
    ],
    lesson: "Spare copies of important pieces mean one failure is an inconvenience instead of an outage.",
    check: (d, ctx) => {
      const db = firstOf(d, "DB"), app = firstOf(d, "APP");
      if (!db) return { done: false, progress: "Add a database first." };
      const lostDb = sim(d, ctx, ["KILL"], db).dmg;
      const lostApp = app ? sim(d, ctx, ["KILL"], app).dmg : 0;
      const worst = Math.max(lostDb, lostApp);
      return { done: worst < 15, progress: worst < 15 ? "Losing your database or an application server barely hurts. Well done." : `Crashing your ${lostDb >= lostApp ? "database" : "application server"} would cost you ${Math.round(worst)} health. Aim for under 15.` };
    },
  },
];

export interface MissionProgress { readonly steps: readonly (MissionCheck & { readonly id: string })[]; readonly currentIndex: number; readonly complete: boolean }

export function evaluateMissions(d: Design, ctx: MissionContext): MissionProgress {
  const steps = LINKSMASH_MISSIONS.map((s) => ({ id: s.id, ...s.check(d, ctx) }));
  const firstOpen = steps.findIndex((s) => !s.done);
  return { steps, currentIndex: firstOpen === -1 ? steps.length - 1 : firstOpen, complete: firstOpen === -1 };
}
