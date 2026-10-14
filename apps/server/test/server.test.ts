import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { io as connect, type Socket } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import { botStep, stateHash, verifyReplay, makeBotRng, type BotMemo, type BotTier, type PlayerView } from "./support.js";
import { createServer } from "../src/server.js";
import { findPairs, searchBand } from "../src/matchmaking.js";
import { eloChange, expectedScore } from "../src/rating.js";
import { Store } from "../src/store.js";

const FAST = { briefMs: 500, draftRevealMs: 30, draftPerPairMs: 4000, buildMs: 8000, reconMs: 3000, declareMs: 3000, respondMs: 2000, resolveMs: 60 };
type Srv = ReturnType<typeof createServer>;
const open: Srv[] = [];
const cleanup: (() => void)[] = [];
afterEach(async () => { for (const s of open.splice(0)) await s.close().catch(() => {}); for (const c of cleanup.splice(0)) c(); });

async function boot(opts: Parameters<typeof createServer>[0] = {}): Promise<{ srv: Srv; url: string }> {
  const srv = createServer({ durations: FAST, botDelayMs: 0, sweepMs: 40, matchmakingMs: 100, disconnectGraceMs: 400, ...opts });
  open.push(srv);
  const port = await srv.listen(0);
  return { srv, url: `http://127.0.0.1:${port}` };
}
const post = (url: string, body: unknown, token?: string) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
const get = (url: string, token?: string) => fetch(url, { headers: token ? { authorization: `Bearer ${token}` } : {} });
async function guest(url: string, handle: string): Promise<{ token: string; id: string }> {
  const r = await post(url + "/api/guest", { handle });
  const j = await r.json() as { token: string; user: { id: string } };
  return { token: j.token, id: j.user.id };
}
async function waitFor<T>(fn: () => T | undefined | false, ms = 15000, what = "condition"): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v as T;
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 15));
  }
}

/** A player who sees ONLY what the server sends, and plays it with the same bot logic the browser uses. */
class Player {
  socket: Socket; views: PlayerView[] = []; latest: PlayerView | null = null; matchId: string | null = null;
  rejected: string[] = []; memo: BotMemo = {}; private rng; private inflight = false; auto = true;
  constructor(url: string, token: string, private tier: BotTier = "easy", seed = 1) {
    this.rng = makeBotRng(seed);
    this.socket = connect(url, { auth: { token }, transports: ["websocket"], reconnection: false });
    this.socket.on("match:found", (p: { matchId: string }) => { this.matchId = p.matchId; this.socket.emit("match:attach", { matchId: p.matchId }, () => {}); });
    this.socket.on("view", (p: { view: PlayerView }) => { this.latest = p.view; this.views.push(p.view); this.drive(); });
  }
  ready(): Promise<void> { return new Promise((res, rej) => { this.socket.on("connect", res); this.socket.on("connect_error", rej); }); }
  call<T = { ok: boolean; [k: string]: unknown }>(ev: string, payload: unknown = {}): Promise<T> { return new Promise((res) => this.socket.emit(ev, payload, res)); }
  send(intent: unknown): Promise<{ ok: boolean; reason?: string }> { return this.call("intent", { matchId: this.matchId, intent }); }
  private drive(): void {
    if (!this.auto || this.inflight || !this.latest || !this.matchId) return;
    const intent = botStep(this.latest, this.rng, this.tier, this.memo);
    if (!intent) return;
    this.inflight = true;
    this.socket.emit("intent", { matchId: this.matchId, intent }, (r: { ok: boolean; reason?: string }) => {
      this.inflight = false;
      if (!r.ok) this.rejected.push(r.reason ?? "?");
      this.drive();
    });
  }
  close(): void { this.socket.close(); }
}

describe("ratings and matchmaking (pure)", () => {
  it("Elo: equal players swing by half the stake, upsets move more, and it is zero-sum", () => {
    expect(eloChange(1200, 1200, 1)).toEqual({ a: 16, b: -16 });
    expect(eloChange(1000, 1400, 1).a).toBeGreaterThan(28);
    expect(eloChange(1400, 1000, 1).a).toBeLessThan(4);
    for (const [a, b, s] of [[1200, 1300, 0.5], [900, 1500, 0], [1600, 1200, 1]] as const) { const d = eloChange(a, b, s); expect(d.a + d.b).toBe(0); }
    expect(expectedScore(1200, 1200)).toBeCloseTo(0.5, 9);
  });

  it("pairs close ratings at once and widens the search the longer someone waits", () => {
    const q = [{ userId: "a", elo: 1200, since: 0 }, { userId: "b", elo: 1250, since: 0 }, { userId: "c", elo: 1900, since: 0 }];
    expect(findPairs(q, 1000).map((p) => p.map((e) => e.userId))).toEqual([["a", "b"]]);
    expect(findPairs([q[0]!, q[2]!], 1000)).toEqual([]);                      // too far apart right now
    expect(searchBand(0)).toBe(120);
    expect(searchBand(60_000)).toBeGreaterThan(searchBand(0));
    expect(searchBand(10 * 60_000)).toBe(400);                               // capped
    expect(findPairs([q[0]!, q[2]!], 10 * 60_000).length).toBe(0);           // 700 apart exceeds even the cap
    expect(findPairs([{ userId: "x", elo: 1200, since: 0 }, { userId: "y", elo: 1480, since: 0 }], 60_000).length).toBe(1);
  });

  it("never pairs a player with themselves or twice", () => {
    const q = Array.from({ length: 7 }, (_, i) => ({ userId: "u" + i, elo: 1200 + i, since: i }));
    const pairs = findPairs(q, 1000);
    const seen = new Set<string>();
    for (const [a, b] of pairs) { expect(a.userId).not.toBe(b.userId); expect(seen.has(a.userId) || seen.has(b.userId)).toBe(false); seen.add(a.userId); seen.add(b.userId); }
    expect(pairs.length).toBe(3);
  });
});

describe("accounts and the store", () => {
  it("handles are unique regardless of case, and tokens identify the right user", () => {
    const st = new Store();
    const a = st.createGuest("Ada", 1) as { token: string; user: { id: string } };
    expect(st.createGuest("ada", 2)).toEqual({ error: "taken" });
    expect(st.userByToken(a.token)?.id).toBe(a.user.id);
    expect(st.userByToken("nope")).toBeNull();
    st.close();
  });

  it("the leaderboard orders by rating and ignores players who have not played", () => {
    const st = new Store();
    const [a, b, c] = ["Ada", "Bob", "Cy"].map((h) => (st.createGuest(h, 1) as { user: { id: string } }).user.id) as [string, string, string];
    st.applyResult(a, 20, "win"); st.applyResult(b, -20, "loss");
    expect(st.leaderboard().map((u) => u.handle)).toEqual(["Ada", "Bob"]);
    expect(st.user(c)!.games).toBe(0);
    st.close();
  });
});

describe("HTTP", () => {
  it("creates accounts, rejects bad or taken names, and protects private routes", async () => {
    const { url } = await boot();
    expect((await post(url + "/api/guest", { handle: "x" })).status).toBe(400);
    expect((await post(url + "/api/guest", { handle: "bad name!" })).status).toBe(400);
    const g = await guest(url, "Ada");
    expect((await post(url + "/api/guest", { handle: "ADA" })).status).toBe(409);
    expect((await get(url + "/api/me")).status).toBe(401);
    expect(((await (await get(url + "/api/me", g.token)).json()) as { handle: string }).handle).toBe("Ada");
    expect((await get(url + "/api/history")).status).toBe(401);
    expect((await get(url + "/api/matches/m_nope")).status).toBe(404);
    const daily = await (await get(url + "/api/daily")).json() as { day: string; seed: number };
    expect(daily.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(daily.seed).toBeGreaterThan(0);
  });

  it("sockets refuse anyone who has not signed in", async () => {
    const { url } = await boot();
    const s = connect(url, { auth: { token: "bogus" }, transports: ["websocket"], reconnection: false });
    const err = await new Promise<Error>((res) => s.on("connect_error", res));
    expect(err.message).toMatch(/Sign in/);
    s.close();
  });
});

describe("a live match between two people", () => {
  it("plays through every phase over the wire, with fog, a verified replay, and rating changes", async () => {
    const { srv, url } = await boot();
    const [ada, bob] = [await guest(url, "Ada"), await guest(url, "Bob")];
    const A = new Player(url, ada.token, "normal", 1), B = new Player(url, bob.token, "easy", 2);
    await Promise.all([A.ready(), B.ready()]);

    const made = await A.call<{ ok: boolean; code: string }>("room:create");
    expect(made.code).toMatch(/^[A-Z2-9]{5}$/);
    expect((await B.call("room:join", { code: "ZZZZZ" })).ok).toBe(false);
    expect((await A.call("room:join", { code: made.code })).ok).toBe(false);          // cannot join your own room
    const joined = await B.call<{ ok: boolean; matchId: string }>("room:join", { code: made.code });
    expect(joined.ok).toBe(true);

    await waitFor(() => A.latest?.phase === "review" && B.latest?.phase === "review", 25000, "both players to reach the review screen");
    expect(A.rejected, "a client sent an illegal move: " + A.rejected.join(" | ")).toEqual([]);
    expect(B.rejected).toEqual([]);

    // everyone saw every phase, in order
    const phases = (p: Player) => [...new Set(p.views.map((v) => v.phase))];
    expect(phases(A)).toEqual(["lobby", "brief", "draft", "build", "recon", "siege", "review"]);
    expect(phases(B)).toEqual(["lobby", "brief", "draft", "build", "recon", "siege", "review"]);

    // both agree on the result
    expect(A.latest!.result).toEqual(B.latest!.result);
    expect(A.latest!.self.hp).toBe(B.latest!.rival.hp);
    expect(A.latest!.rounds.length).toBe(B.latest!.rounds.length);

    // FOG: while the match was live, Ada never saw an unscouted piece of Bob's design
    const secret = srv.store.match(joined.matchId)!;
    const bobDesign = (JSON.parse(secret.log) as { config: unknown }).config;
    void bobDesign;
    for (const v of A.views.filter((x) => x.phase === "recon" || x.phase === "siege")) {
      const scouted = new Set(v.self.revealedParts);
      for (const n of v.rival.design!.nodes) if (n.part !== "CLIENT" && !scouted.has(n.id)) expect(n.part, `${n.id} leaked during ${v.phase}`).toBe("UNKNOWN");
      if (!v.self.revealedPolicy) expect(v.rival.design!.policy).toBeNull();
    }
    for (const v of A.views.filter((x) => x.phase === "build")) expect(v.rival.design).toBeNull();

    // the stored match is public and re-runs to exactly the same result
    const stored = await (await get(`${url}/api/matches/${joined.matchId}`)).json() as { log: Parameters<typeof verifyReplay>[0]; winner: string; eloChange0: number; eloChange1: number };
    const check = verifyReplay(stored.log);
    expect(check.ok, check.reason).toBe(true);
    expect(stateHash(check.state!)).toBe(stored.log.finalHash);
    expect(String(A.latest!.result!.winner)).toBe(stored.winner);

    // ratings moved by equal and opposite amounts (or not at all for a draw)
    const ua = srv.store.user(ada.id)!, ub = srv.store.user(bob.id)!;
    expect(ua.games).toBe(1); expect(ub.games).toBe(1);
    expect(ua.elo - 1200).toBe(stored.eloChange0); expect(ub.elo - 1200).toBe(stored.eloChange1);
    expect(stored.eloChange0 + stored.eloChange1).toBe(0);
    if (stored.winner === "0") { expect(ua.wins).toBe(1); expect(ub.losses).toBe(1); }

    const board = await (await get(url + "/api/leaderboard")).json() as { handle: string }[];
    expect(board.length).toBe(2);
    expect((await (await get(url + "/api/history", ada.token)).json() as unknown[]).length).toBe(1);
    A.close(); B.close();
  });

  it("refuses illegal moves over the wire: forged results, out-of-turn picks, outsiders, nonsense", async () => {
    const { url } = await boot();
    const [ada, bob, eve] = [await guest(url, "Ada"), await guest(url, "Bob"), await guest(url, "Eve")];
    const A = new Player(url, ada.token), B = new Player(url, bob.token), E = new Player(url, eve.token);
    for (const p of [A, B]) p.auto = false;
    await Promise.all([A.ready(), B.ready(), E.ready()]);
    const { code } = await A.call<{ code: string }>("room:create");
    const { matchId } = await B.call<{ matchId: string }>("room:join", { code });
    await waitFor(() => A.latest?.phase === "brief" && B.latest?.phase === "brief", 5000, "the briefing");
    expect((await A.send({ k: "draft.pick", pair: 0, choice: "a" })).reason).toMatch(/not the drafting stage/);   // problem first, choices after
    expect((await A.send({ k: "brief.done" })).ok).toBe(true);
    expect((await B.send({ k: "brief.done" })).ok).toBe(true);
    await waitFor(() => A.latest?.phase === "draft" && B.latest?.phase === "draft", 5000, "draft");

    expect((await A.send({ k: "draft.pick", pair: 0, choice: "a", result: "win", hp: 999 })).ok).toBe(true);    // extra fields are ignored
    expect((await A.send({ k: "draft.pick", pair: 1, choice: "a" })).ok).toBe(false);                            // not your turn (and out of order)
    await waitFor(() => A.latest?.draft?.index === 1, 3000, "the reveal to finish");
    expect((await B.send({ k: "draft.pick", pair: 0, choice: "b" })).reason).toMatch(/no longer open/);            // that pair is already decided
    expect((await A.send({ k: "draft.pick", pair: 1, choice: "b" })).reason).toMatch(/rival's turn/);              // pair 1 is Bob's choice
    expect((await A.send({ k: "siege.declare", attack: { id: "SPIKE" }, telegraph: "load" })).ok).toBe(false);   // wrong phase
    expect((await A.send({ k: "nonsense" })).reason).toMatch(/not understood/);
    expect((await A.send({ k: "build.lock" })).ok).toBe(false);

    E.matchId = matchId;                                                                                        // an outsider
    expect((await E.send({ k: "forfeit" })).reason).toMatch(/not part of that match/);
    expect((await E.call("match:attach", { matchId })).ok).toBe(false);
    expect(A.latest!.rival.hp).toBe(100);
    A.close(); B.close(); E.close();
  });

  it("a player who loses their connection can come back and carry on", async () => {
    const { url } = await boot({ disconnectGraceMs: 5000 });
    const [ada, bob] = [await guest(url, "Ada"), await guest(url, "Bob")];
    let A = new Player(url, ada.token, "easy", 1);
    const B = new Player(url, bob.token, "easy", 2);
    await Promise.all([A.ready(), B.ready()]);
    const { code } = await A.call<{ code: string }>("room:create");
    await B.call("room:join", { code });
    await waitFor(() => A.latest?.phase === "build", 10000, "build phase");
    A.close();                                                                           // Ada drops mid-match
    await new Promise((r) => setTimeout(r, 200));
    A = new Player(url, ada.token, "easy", 3);                                           // and returns on a new connection
    await A.ready();
    await waitFor(() => A.matchId, 3000, "to be handed back to her match");
    await waitFor(() => A.latest?.phase === "review" && B.latest?.phase === "review", 25000, "the match to finish");
    expect(A.latest!.result!.reason).not.toBe("forfeit");
    A.close(); B.close();
  });

  it("forfeits a player who never comes back, after the grace period", async () => {
    const { url } = await boot({ disconnectGraceMs: 300 });
    const [ada, bob] = [await guest(url, "Ada"), await guest(url, "Bob")];
    const A = new Player(url, ada.token, "easy", 1), B = new Player(url, bob.token, "easy", 2);
    A.auto = false;                                                  // Ada connects but never acts
    await Promise.all([A.ready(), B.ready()]);
    const { code } = await A.call<{ code: string }>("room:create");
    await B.call("room:join", { code });
    await waitFor(() => B.views.some((v) => v.phase === "draft"), 5000, "draft");
    A.close();
    await waitFor(() => B.latest?.phase === "review", 8000, "the forfeit");
    expect(B.latest!.result).toEqual({ winner: 1, reason: "forfeit" });
    B.close();
  });

  it("the ranked queue pairs two waiting players", async () => {
    const { url } = await boot();
    const [ada, bob] = [await guest(url, "Ada"), await guest(url, "Bob")];
    const A = new Player(url, ada.token, "easy", 1), B = new Player(url, bob.token, "easy", 2);
    await Promise.all([A.ready(), B.ready()]);
    expect((await A.call("queue:join")).ok).toBe(true);
    await new Promise((r) => setTimeout(r, 250));
    expect(A.matchId).toBeNull();                                      // alone in the queue: nothing yet
    expect((await B.call("queue:join")).ok).toBe(true);
    await waitFor(() => A.matchId && A.matchId === B.matchId, 5000, "a pairing");
    expect((await A.call("queue:join")).ok).toBe(false);               // already in a match
    A.close(); B.close();
  });
});

describe("practice, the daily challenge, and surviving a restart", () => {
  it("a practice match against the server's bot runs to a result and counts for nobody's rating", async () => {
    const { srv, url } = await boot();
    const ada = await guest(url, "Ada");
    const A = new Player(url, ada.token, "normal", 1);
    await A.ready();
    const r = await A.call<{ ok: boolean }>("practice:start", { tier: "easy" });
    expect(r.ok).toBe(true);
    await waitFor(() => A.latest?.phase === "review", 30000, "the practice match");
    expect(srv.store.user(ada.id)!.games).toBe(0);
    expect(A.latest!.rival.handle).toBe("Practice bot");
    A.close();
  });

  it("the daily challenge posts a score everyone can see", async () => {
    const { url } = await boot();
    const ada = await guest(url, "Ada");
    const A = new Player(url, ada.token, "normal", 1);
    await A.ready();
    expect((await A.call("practice:start", { daily: true })).ok).toBe(true);
    await waitFor(() => A.latest?.phase === "review", 30000, "the daily match");
    await new Promise((r) => setTimeout(r, 100));
    const d = await (await get(url + "/api/daily")).json() as { board: { handle: string; score: number }[] };
    expect(d.board.length).toBe(1);
    expect(d.board[0]!.handle).toBe("Ada");
    expect(d.board[0]!.score).toBeGreaterThan(0);
    A.close();
  });

  it("a match carries on after the server restarts, because its deadlines live in its saved state", async () => {
    const dir = mkdtempSync(join(tmpdir(), "siege-"));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const dbPath = join(dir, "t.sqlite");
    let now = 1_000_000;
    const first = createServer({ dbPath, clock: () => now, durations: FAST, botDelayMs: 0 });
    const port1 = await first.listen(0);
    const url1 = `http://127.0.0.1:${port1}`;
    const ada = await guest(url1, "Ada");
    const A = new Player(url1, ada.token, "easy", 1);
    await A.ready();
    await A.call("practice:start", { tier: "easy" });
    // the match now waits out a briefing and a short reveal after each pick, so let this test's clock run until the build starts
    const run = setInterval(() => { now += 100; }, 15);
    await waitFor(() => A.latest?.phase === "build", 10000, "build");
    clearInterval(run);
    const matchId = A.matchId!;
    const before = first.runtime.get(matchId)!.state;
    const hashBefore = stateHash(before);
    const deadline = before.deadlineAt!;
    A.close();
    await first.close();

    // ...the process is gone. A new one starts on the same database, with the clock past the deadline.
    now = deadline + 100;
    const second = createServer({ dbPath, clock: () => now, durations: FAST, botDelayMs: 0 });
    open.push(second);
    await second.listen(0);
    const live = second.runtime.get(matchId);
    expect(live, "the match should have been restored").toBeTruthy();
    expect(live!.state.version).toBe(before.version);
    expect(stateHash(live!.state)).toBe(hashBefore);
    second.runtime.sweep();                                          // the sweeper notices the expired deadline
    expect(second.runtime.get(matchId)!.state.phase).toBe("recon");
  });
});
