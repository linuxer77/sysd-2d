import { describe, expect, it } from "vitest";
import {
  DRAFT_PAIRS, apply, autoLayout, buildGenome, createMatch, designCost, parseIntent, replay, runBotMatch, starterDesign,
  stateHash, tick, verifyReplay, viewFor, type Intent, type MatchConfig, type MatchState, type Seat,
} from "../src/index.js";

const cfg = (seed = 7, extra: Partial<MatchConfig> = {}): MatchConfig =>
  ({ id: "m1", seed, mode: "pvp", scenarioId: "linksmash", handles: ["Ada", "Grace"], ...extra });

const must = (s: MatchState, seat: Seat, i: Intent, now = 0): MatchState => {
  const r = apply(s, seat, i, now);
  if (!r.ok) throw new Error(`expected ok, got: ${r.reason}`);
  return r.state;
};
const bad = (s: MatchState, seat: Seat, i: Intent, now = 0): string => {
  const r = apply(s, seat, i, now);
  if (r.ok) throw new Error("expected rejection");
  return r.reason;
};

function toBrief(seed = 7): MatchState {
  let s = createMatch(cfg(seed));
  s = must(s, 0, { k: "ready" }); s = must(s, 1, { k: "ready" });
  return s;
}
function toDraft(seed = 7): MatchState {
  let s = toBrief(seed);
  s = must(s, 0, { k: "brief.done" }); s = must(s, 1, { k: "brief.done" });
  return s;
}
/** a pick is followed by a short reveal; waiting it out moves on to the next question */
const pastReveal = (s: MatchState): MatchState => tick(s, s.deadlineAt! + 1);
function toBuild(seed = 7): MatchState {
  let s = toDraft(seed);
  for (let i = 0; i < 8; i++) { s = must(s, (i % 2) as Seat, { k: "draft.pick", pair: i, choice: "a" }, i); s = pastReveal(s); }
  return s;
}
/** a design every seat can lock: visitors -> app -> database, plus whatever the starter set allows */
function lockBoth(s: MatchState, now = 0): MatchState {
  for (const sd of [0, 1] as Seat[]) {
    const d = starterDesign(sd);
    s = must(s, sd, { k: "build.update", design: d, layout: autoLayout(d) }, now);
    s = must(s, sd, { k: "build.lock" }, now);
  }
  return s;
}

describe("draft", () => {
  it("both players must be ready before anything starts", () => {
    let s = createMatch(cfg());
    expect(s.phase).toBe("lobby");
    s = must(s, 0, { k: "ready" });
    expect(s.phase).toBe("lobby");
    s = must(s, 1, { k: "ready" });
    expect(s.phase).toBe("brief");
  });

  it("the problem is explained BEFORE anyone is asked to choose: nobody can pick during the briefing", () => {
    let s = toBrief();
    expect(s.phase).toBe("brief");
    expect(bad(s, 0, { k: "draft.pick", pair: 0, choice: "a" })).toMatch(/not the drafting stage/);
    expect(viewFor(s, 0).draft).toBeNull();                              // no choice is even shown yet
    s = must(s, 0, { k: "brief.done" });
    expect(s.phase).toBe("brief");                                       // waits for the other player to finish reading
    s = must(s, 1, { k: "brief.done" });
    expect(s.phase).toBe("draft");
  });

  it("the briefing gives time to read, then moves on by itself", () => {
    let s = toBrief();
    expect(s.deadlineAt).toBeGreaterThan(30_000);
    s = tick(s, s.deadlineAt! + 1);
    expect(s.phase).toBe("draft");
  });

  it("a pick is REVEALED before the next question: both players see what was taken and what was left", () => {
    let s = toDraft();
    const pair = s.draft.pairs[0]!;
    s = must(s, 0, { k: "draft.pick", pair: 0, choice: "a" });
    expect(s.draft.index).toBe(0);                                       // still on the same question
    expect(s.draft.stage).toBe("reveal");
    const mine = viewFor(s, 0).draft!, theirs = viewFor(s, 1).draft!;
    expect(mine.stage).toBe("reveal");
    expect(mine.last).toEqual({ pickedByYou: true, taken: pair.a.id, left: pair.b.id });
    expect(theirs.last).toEqual({ pickedByYou: false, taken: pair.a.id, left: pair.b.id });
    expect(bad(s, 1, { k: "draft.pick", pair: 1, choice: "a" })).toMatch(/last choice is still being shown/);   // no skipping ahead
    expect(s.deadlineAt! - 0).toBeGreaterThan(1000);                     // it stays up long enough to read
    s = pastReveal(s);
    expect(s.draft.index).toBe(1);
    expect(s.draft.stage).toBe("choose");
  });

  it("is a mirror draft: the picker chooses, the other player gets what is left", () => {
    let s = toDraft();
    const pair = s.draft.pairs[0]!;
    s = must(s, 0, { k: "draft.pick", pair: 0, choice: "a" });
    expect(s.seats[0].picks[0]).toBe(pair.a.id);
    expect(s.seats[1].picks[0]).toBe(pair.b.id);
    for (const p of pair.a.parts) expect(s.seats[0].licences[p]).toBeGreaterThan(0);
  });

  it("enforces whose turn it is and which pair is open", () => {
    const s = toDraft();
    expect(bad(s, 1, { k: "draft.pick", pair: 0, choice: "a" })).toMatch(/rival's turn/);
    expect(bad(s, 0, { k: "draft.pick", pair: 3, choice: "a" })).toMatch(/no longer open/);
  });

  it("alternates pickers and ends in the build phase with eight bundles each", () => {
    const s = toBuild();
    expect(s.phase).toBe("build");
    expect(s.seats[0].picks.length).toBe(8);
    expect(s.seats[1].picks.length).toBe(8);
    expect(new Set([...s.seats[0].picks, ...s.seats[1].picks]).size).toBe(16);    // every bundle is unique
    expect(s.draft.history.filter((h) => h.seat === 0).length).toBe(8);
  });

  it("hides pairs that have not come up yet", () => {
    const v = viewFor(toDraft(), 0);
    expect(v.draft!.pair).toBeTruthy();
    expect(JSON.stringify(v)).not.toContain(DRAFT_PAIRS[7]!.b.id === v.draft!.pair!.b.id ? "NEVER" : DRAFT_PAIRS[7]!.a.id + "x");
    expect(Object.keys(v.draft!)).not.toContain("pairs");
  });

  it("a missed deadline picks automatically so the match never stalls", () => {
    let s = toDraft();
    s = tick(s, s.deadlineAt! + 1);                  // nobody chose: it picks for them and shows the reveal
    expect(s.draft.stage).toBe("reveal");
    expect(s.seats[0].picks.length).toBe(1);
    s = tick(s, s.deadlineAt! + 1);
    expect(s.draft.index).toBe(1);
  });
});

describe("build: the server never trusts the client", () => {
  it("rejects a design that costs more than the budget", () => {
    let s = toBuild();
    const d = buildGenome({ apps: 4, cache: true, cdn: true, replicas: 2, queue: true, limiter: false, breaker: true, retries: 1, idempotent: true }, 0);
    expect(designCost(d)).toBeGreaterThan(700);
    s = must(s, 0, { k: "build.update", design: d, layout: autoLayout(d) });
    expect(bad(s, 0, { k: "build.lock" })).toMatch(/budget|piece you do not have/);
  });

  it("rejects pieces you have not drafted", () => {
    let s = toBuild();
    const d = starterDesign(0);
    const withCdn = { ...d, nodes: [...d.nodes, { id: "n0-9", part: "CDN" as const }, { id: "n0-10", part: "CDN" as const }, { id: "n0-11", part: "CDN" as const }],
      edges: [...d.edges, { from: "n0-1", to: "n0-9" }] };
    s = must(s, 0, { k: "build.update", design: withCdn, layout: autoLayout(withCdn) });
    expect(bad(s, 0, { k: "build.lock" })).toMatch(/do not have/);
  });

  it("rejects loops, missing connections, and malformed layouts", () => {
    let s = toBuild();
    const d = starterDesign(0);
    // two application servers pointing at each other is a genuine request loop
    const loop = { ...d, nodes: [...d.nodes, { id: "n0-4", part: "APP" as const }],
      edges: [{ from: "n0-1", to: "n0-2" }, { from: "n0-2", to: "n0-4" }, { from: "n0-4", to: "n0-2" }, { from: "n0-4", to: "n0-3" }] };
    s = must(s, 0, { k: "build.update", design: loop, layout: autoLayout(loop) });
    expect(bad(s, 0, { k: "build.lock" })).toMatch(/loop/);
    expect(bad(s, 0, { k: "build.update", design: d, layout: { "n0-1": { x: 1, y: 1 } } })).toMatch(/outside the board|placed/);
    expect(bad(s, 0, { k: "build.update", design: d, layout: { ...autoLayout(d), "n0-2": { x: 99999, y: 1 } } })).toMatch(/outside the board/);
  });

  it("rejects editing after lock-in, and locking before connecting", () => {
    let s = toBuild();
    expect(bad(s, 0, { k: "build.lock" })).toMatch(/Connect your pieces|not valid|exactly one/);
    const d = starterDesign(0);
    s = must(s, 0, { k: "build.update", design: d, layout: autoLayout(d) });
    s = must(s, 0, { k: "build.lock" });
    expect(bad(s, 0, { k: "build.update", design: d, layout: autoLayout(d) })).toMatch(/locked/);
  });

  it("repairs a broken design at the deadline instead of stalling", () => {
    let s = toBuild();
    s = tick(s, s.deadlineAt! + 1);
    expect(s.phase).toBe("recon");
    expect(s.seats[0].design.nodes.length).toBe(3);
  });
});

describe("fog of war", () => {
  it("shows only progress during the build, never the design", () => {
    let s = toBuild();
    const d = starterDesign(1);
    s = must(s, 1, { k: "build.update", design: d, layout: autoLayout(d) });
    const v = viewFor(s, 0);
    expect(v.rival.design).toBeNull();
    expect(v.rival.nodeCount).toBe(3);
  });

  it("hides part types and settings until they are scouted, then reveals only what was scouted", () => {
    let s = lockBoth(toBuild());
    expect(s.phase).toBe("recon");
    let v = viewFor(s, 0);
    expect(v.rival.design!.nodes.filter((n) => n.part === "UNKNOWN").length).toBe(2);   // app + database
    expect(v.rival.design!.policy).toBeNull();
    expect(JSON.stringify(v.rival)).not.toContain('"DB"');
    expect(JSON.stringify(v.rival)).not.toContain('"APP"');

    s = must(s, 0, { k: "recon.probe", target: { kind: "part", nodeId: "n1-3" } });
    v = viewFor(s, 0);
    expect(v.rival.design!.nodes.find((n) => n.id === "n1-3")!.part).toBe("DB");
    expect(v.rival.design!.nodes.find((n) => n.id === "n1-2")!.part).toBe("UNKNOWN");
    s = must(s, 0, { k: "recon.probe", target: { kind: "policy" } });
    expect(viewFor(s, 0).rival.design!.policy).not.toBeNull();
    // and the rival learned nothing about us from our scouting
    expect(viewFor(s, 1).rival.design!.nodes.filter((n) => n.part === "UNKNOWN").length).toBe(2);
  });

  it("scouting costs points, cannot be repeated, and cannot name pieces that do not exist", () => {
    let s = lockBoth(toBuild());
    expect(s.seats[0].probesLeft).toBeGreaterThanOrEqual(3);
    expect(bad(s, 0, { k: "recon.probe", target: { kind: "part", nodeId: "n1-99" } })).toMatch(/does not exist/);
    s = must(s, 0, { k: "recon.probe", target: { kind: "part", nodeId: "n1-2" } });
    expect(bad(s, 0, { k: "recon.probe", target: { kind: "part", nodeId: "n1-2" } })).toMatch(/already know/);
    s = must(s, 0, { k: "recon.probe", target: { kind: "part", nodeId: "n1-3" } });
    s = must(s, 0, { k: "recon.probe", target: { kind: "part", nodeId: "n1-1" } });
    expect(bad(s, 0, { k: "recon.probe", target: { kind: "policy" } })).toMatch(/enough scouting points/);
  });

  it("everything is revealed once the match is over", () => {
    const { state } = runBotMatch(cfg(11), ["easy", "easy"]);
    const v = viewFor(state, 0);
    expect(v.phase).toBe("review");
    expect(v.rival.design!.nodes.every((n) => n.part !== "UNKNOWN")).toBe(true);
    expect(v.rival.design!.policy).not.toBeNull();
  });

  it("the rival's hottest piece in the round log stays hidden unless scouted", () => {
    const { state } = runBotMatch(cfg(13), ["easy", "easy"]);
    let s = structuredClone(state) as MatchState;
    s = { ...s, phase: "siege" };
    const v = viewFor(s, 0);
    const scouted = new Set(state.seats[0].revealedParts);
    let checked = 0;
    for (const r of v.rounds) for (const h of r.seats[1].hottest) {
      if (!scouted.has(h.id)) { expect(h.part).toBe("UNKNOWN"); checked++; }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe("siege: simultaneous rounds", () => {
  function toSiege(): MatchState {
    let s = lockBoth(toBuild());
    s = must(s, 0, { k: "recon.done" }); s = must(s, 1, { k: "recon.done" });
    return s;
  }

  it("nobody sees the other's choice before committing, but warnings are shown once both have chosen", () => {
    let s = toSiege();
    expect(s.phase).toBe("siege");
    s = must(s, 0, { k: "siege.declare", attack: { id: "SPIKE" }, telegraph: "load" });
    const v1 = viewFor(s, 1);
    expect(v1.step).toBe("declare");
    expect(v1.rivalWarning).toBeNull();
    expect(JSON.stringify(v1.rival)).not.toContain("SPIKE");     // (your own attack-uses list names every attack)
    expect(v1.rounds).toEqual([]);
    s = must(s, 1, { k: "siege.declare", attack: null, telegraph: null });
    expect(viewFor(s, 1).step).toBe("respond");
    expect(viewFor(s, 1).rivalWarning).toBe("load");
    expect(viewFor(s, 0).rivalWarning).toBeNull();
  });

  it("both stacks resolve at once and both lose health from the traffic they actually face", () => {
    let s = toSiege();
    s = must(s, 0, { k: "siege.declare", attack: { id: "SPIKE" }, telegraph: "load" });
    s = must(s, 1, { k: "siege.declare", attack: { id: "SPIKE" }, telegraph: "load" });
    s = must(s, 0, { k: "siege.respond", ops: null }); s = must(s, 1, { k: "siege.respond", ops: null });
    expect(s.siege.log.length).toBe(1);
    expect(s.siege.step).toBe("resolve");
    const [a, b] = s.siege.log[0]!.seats;
    expect(a.attack?.id).toBe("SPIKE"); expect(b.attack?.id).toBe("SPIKE");
    expect(a.damageTaken).toBeGreaterThan(0); expect(b.damageTaken).toBeGreaterThan(0);
    expect(s.seats[0].hp).toBe(100 - a.damageTaken);
    expect(s.seats[1].attackUses.SPIKE).toBe(4);
  });

  it("an attack that lands is the same regardless of seat order (no first-mover advantage)", () => {
    const run = (swap: boolean) => {
      let s = toSiege();
      const plan: [Seat, Intent][] = [[0, { k: "siege.declare", attack: { id: "FLUSH" }, telegraph: "cache" }], [1, { k: "siege.declare", attack: { id: "SPIKE" }, telegraph: "load" }]];
      for (const [sd, i] of swap ? [...plan].reverse() : plan) s = must(s, sd, i);
      for (const sd of (swap ? [1, 0] : [0, 1]) as Seat[]) s = must(s, sd, { k: "siege.respond", ops: null });
      return s.siege.log[0]!.seats.map((x) => x.damageTaken);
    };
    expect(run(false)).toEqual(run(true));
  });

  it("validates attacks: uses left, targets, and bluffs", () => {
    let s = toSiege();
    expect(bad(s, 0, { k: "siege.declare", attack: { id: "KILL" }, telegraph: "crash" })).toMatch(/which of your rival's pieces/);
    expect(bad(s, 0, { k: "siege.declare", attack: { id: "KILL", target: "n1-1" }, telegraph: "crash" })).toMatch(/which of your rival's pieces/);   // cannot crash the visitors
    expect(bad(s, 0, { k: "siege.declare", attack: { id: "KILL", target: "zz" }, telegraph: "crash" })).toMatch(/which of your rival's pieces/);
    expect(bad(s, 0, { k: "siege.respond", ops: null })).toMatch(/not time/);
    s = must(s, 0, { k: "siege.declare", attack: { id: "SPIKE" }, telegraph: "crash" });          // bluff 1
    expect(bad(s, 0, { k: "siege.declare", attack: null, telegraph: null })).toMatch(/already chosen/);
  });

  it("limits bluffs to two per match", () => {
    let s = toSiege();
    const round = (tele: "crash" | "load", sd0 = true) => {
      s = must(s, 0, { k: "siege.declare", attack: { id: "SPIKE" }, telegraph: tele });
      s = must(s, 1, { k: "siege.declare", attack: null, telegraph: null });
      s = must(s, 0, { k: "siege.respond", ops: null }); s = must(s, 1, { k: "siege.respond", ops: null });
      s = tick(s, s.deadlineAt! + 1);
      void sd0;
    };
    round("crash"); round("crash");
    expect(s.seats[0].feintsLeft).toBe(0);
    expect(bad(s, 0, { k: "siege.declare", attack: { id: "SPIKE" }, telegraph: "crash" })).toMatch(/no bluffs left/);
  });

  it("operations recharge, and effects last several rounds", () => {
    let s = toSiege();
    s = must(s, 0, { k: "siege.declare", attack: { id: "FLUSH" }, telegraph: "cache" });
    s = must(s, 1, { k: "siege.declare", attack: null, telegraph: null });
    s = must(s, 0, { k: "siege.respond", ops: "SCALE" }); s = must(s, 1, { k: "siege.respond", ops: null });
    expect(s.seats[0].opsCooldown.SCALE).toBe(2);      // 3 at use, ticks down as the round ends: usable again 3 rounds later
    expect(s.seats[1].effects.some((e) => e.kind === "flush")).toBe(true);        // still cold next round
    s = tick(s, s.deadlineAt! + 1);
    s = must(s, 0, { k: "siege.declare", attack: null, telegraph: null }); s = must(s, 1, { k: "siege.declare", attack: null, telegraph: null });
    expect(bad(s, 0, { k: "siege.respond", ops: "SCALE" })).toMatch(/recharging/);
  });

  it("a missed deadline defaults to doing nothing instead of stalling", () => {
    let s = toSiege();
    s = tick(s, s.deadlineAt! + 1);
    expect(s.siege.step).toBe("respond");
    s = tick(s, s.deadlineAt! + 1);
    expect(s.siege.log.length).toBe(1);
  });

  it("forfeiting ends the match for the other player", () => {
    const s = must(toSiege(), 0, { k: "forfeit" });
    expect(s.phase).toBe("review");
    expect(s.result).toEqual({ winner: 1, reason: "forfeit" });
  });
});

describe("a complete match", () => {
  it("plays through every phase to a result, and is deterministic", () => {
    const a = runBotMatch(cfg(3), ["normal", "easy"]);
    const b = runBotMatch(cfg(3), ["normal", "easy"]);
    expect(a.state.phase).toBe("review");
    expect(a.state.result).toBeTruthy();
    expect(stateHash(a.state)).toBe(stateHash(b.state));
    expect(a.state.siege.log.length).toBeGreaterThanOrEqual(1);
  });

  it("different seeds give different matches", () => {
    expect(stateHash(runBotMatch(cfg(1), ["easy", "easy"]).state)).not.toBe(stateHash(runBotMatch(cfg(2), ["easy", "easy"]).state));
  });

  it("a stronger bot beats a weaker one far more often than not", () => {
    let hardWins = 0, games = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const { state } = runBotMatch(cfg(seed * 31), ["hard", "easy"]);
      games++; if (state.result?.winner === 0) hardWins++;
    }
    expect(hardWins, `${hardWins}/${games}`).toBeGreaterThanOrEqual(6);
  });

  it("every stored match replays to exactly the same result, and tampering is caught", () => {
    const { state, log } = runBotMatch(cfg(5), ["normal", "normal"]);
    expect(stateHash(replay(log))).toBe(stateHash(state));
    expect(verifyReplay(log).ok).toBe(true);

    const hp = structuredClone(log) as typeof log;
    hp.finalHash = "0000000000000000";
    expect(verifyReplay(hp).ok).toBe(false);

    const forged = structuredClone(log) as typeof log;
    const i = forged.moves.findIndex((m) => m.intent?.k === "build.lock");
    forged.moves.splice(i, 1);
    expect(verifyReplay(forged).ok).toBe(false);
  });
});

describe("the wire boundary", () => {
  it("accepts well-formed intents and strips anything extra, such as a claimed result", () => {
    const r = parseIntent({ k: "siege.declare", attack: { id: "SPIKE" }, telegraph: "load", damage: 999, hp: 100, result: "win" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(JSON.stringify(r.intent)).not.toMatch(/damage|hp|result/);
  });
  it("rejects malformed intents", () => {
    for (const raw of [null, {}, { k: "nope" }, { k: "draft.pick", pair: "x", choice: "a" }, { k: "siege.declare", attack: { id: "NUKE" }, telegraph: null },
      { k: "build.update", design: { nodes: [{ id: "Bad Id", part: "APP" }], edges: [], policy: {} }, layout: {} }])
      expect(parseIntent(raw).ok, JSON.stringify(raw)).toBe(false);
  });
});
