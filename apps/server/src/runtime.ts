import { EventEmitter } from "node:events";
import { randomBytes } from "node:crypto";
import { hash, makeRng, type Rng } from "@sysd/sim";
import { SCENARIOS } from "@sysd/shared";
import {
  MoveRecorder, apply, botStep, createMatch, designCost, tick, verifyReplay, viewFor,
  type BotMemo, type BotTier, type Durations, type Intent, type MatchConfig, type MatchMode, type MatchState, type MoveLog, type PlayerView, type Seat,
} from "@sysd/match";
import { eloChange } from "./rating.js";
import { Store, type User } from "./store.js";

export interface RuntimeOptions {
  store: Store;
  clock?: () => number;
  /** how long a bot waits between actions, so it feels like an opponent rather than a machine */
  botDelayMs?: number;
  /** how long a disconnected player has to come back before the match is forfeited */
  disconnectGraceMs?: number;
  durations?: Partial<Durations>;
}

interface Live {
  id: string;
  config: MatchConfig;
  state: MatchState;
  rec: MoveRecorder;
  users: [string | null, string | null];            // null = a bot
  bots: [BotTier | null, BotTier | null];
  memo: [BotMemo, BotMemo];
  rng: [Rng, Rng];
  botNextAt: [number, number];
  everAttached: [boolean, boolean];
  connected: [boolean, boolean];
  disconnectedAt: [number | null, number | null];
  startedAt: number;
  finalized: boolean;
  finalizedAt: number | null;
}

export interface CreateOptions {
  mode: MatchMode;
  users: [User | null, User | null];
  botTier?: BotTier;
  seed?: number;
  scenarioId?: string;
}

/** UTC calendar day, and a seed derived from it so everyone gets the same daily match. */
export function dailyInfo(now: number): { day: string; seed: number; scenarioId: string } {
  const day = new Date(now).toISOString().slice(0, 10);
  return { day, seed: parseInt(hash("daily:" + day).slice(0, 7), 16), scenarioId: "linksmash" };
}

export class Runtime extends EventEmitter {
  private live = new Map<string, Live>();
  private readonly clock: () => number;
  readonly store: Store;
  private readonly botDelayMs: number;
  private readonly graceMs: number;
  private readonly durations: Partial<Durations> | undefined;

  constructor(opts: RuntimeOptions) {
    super();
    this.store = opts.store;
    this.clock = opts.clock ?? (() => Date.now());
    this.botDelayMs = opts.botDelayMs ?? 900;
    this.graceMs = opts.disconnectGraceMs ?? 45_000;
    this.durations = opts.durations;
  }

  now(): number { return this.clock(); }

  /* ------------------------------------------------------------------ lifecycle */
  create(o: CreateOptions): string {
    const now = this.now();
    const id = "m_" + randomBytes(5).toString("hex");
    const scenarioId = o.scenarioId ?? "linksmash";
    if (!(scenarioId in SCENARIOS)) throw new Error("unknown scenario");
    const botSeat: Seat | null = o.users[1] === null ? 1 : o.users[0] === null ? 0 : null;
    const handles: [string, string] = [o.users[0]?.handle ?? "Practice bot", o.users[1]?.handle ?? "Practice bot"];
    const config: MatchConfig = {
      id, seed: o.seed ?? parseInt(randomBytes(4).toString("hex"), 16) % 2_000_000_000, mode: o.mode, scenarioId, handles,
      ...(this.durations ? { durations: this.durations } : {}),
    };
    const tier = o.botTier ?? "normal";
    const l: Live = {
      id, config, state: createMatch(config), rec: new MoveRecorder(config),
      users: [o.users[0]?.id ?? null, o.users[1]?.id ?? null],
      bots: [botSeat === 0 ? tier : null, botSeat === 1 ? tier : null],
      memo: [{}, {}], rng: [makeRng(config.seed + 11), makeRng(config.seed + 22)],
      botNextAt: [now, now], everAttached: [false, false], connected: [false, false], disconnectedAt: [null, null],
      startedAt: now, finalized: false, finalizedAt: null,
    };
    this.live.set(id, l);
    for (const s of [0, 1] as Seat[]) if (l.bots[s]) this.submitInternal(l, s, { k: "ready" });
    this.persist(l);
    return id;
  }

  get(id: string): Live | undefined { return this.live.get(id); }
  seatOf(matchId: string, userId: string): Seat | null {
    const l = this.live.get(matchId);
    if (!l) return null;
    return l.users[0] === userId ? 0 : l.users[1] === userId ? 1 : null;
  }
  activeMatchOf(userId: string): string | null {
    for (const l of this.live.values()) if ((l.users[0] === userId || l.users[1] === userId) && l.state.phase !== "review") return l.id;
    return null;
  }

  /** A human's connection came or went. The first connection counts as "ready". */
  attach(matchId: string, seat: Seat, connected: boolean): void {
    const l = this.live.get(matchId);
    if (!l) return;
    l.connected[seat] = connected;
    l.disconnectedAt[seat] = connected ? null : this.now();
    if (connected && !l.everAttached[seat]) {
      l.everAttached[seat] = true;
      this.submitInternal(l, seat, { k: "ready" });
    } else this.emit("update", l.id);
  }

  view(matchId: string, seat: Seat): PlayerView | null {
    const l = this.live.get(matchId);
    return l ? viewFor(l.state, seat) : null;
  }

  /** The only way a human changes a match. Everything is validated by the reducer. */
  submit(matchId: string, seat: Seat, intent: Intent): { ok: true } | { ok: false; reason: string } {
    const l = this.live.get(matchId);
    if (!l) return { ok: false, reason: "That match no longer exists." };
    return this.submitInternal(l, seat, intent);
  }

  private submitInternal(l: Live, seat: Seat, intent: Intent): { ok: true } | { ok: false; reason: string } {
    const now = this.now();
    this.advance(l, now);
    const r = apply(l.state, seat, intent, now);
    if (!r.ok) return { ok: false, reason: r.reason };
    l.rec.intent(seat, intent, now);
    l.state = r.state;
    this.afterChange(l);
    return { ok: true };
  }

  /** Process any deadlines that have passed (a no-op if none have). */
  private advance(l: Live, now: number): boolean {
    const next = tick(l.state, now);
    if (next === l.state) return false;
    l.rec.tick(now);
    l.state = next;
    return true;
  }

  private afterChange(l: Live): void {
    if (l.state.phase === "review" && !l.finalized) this.finalize(l);
    this.persist(l);
    this.emit("update", l.id);
  }

  /** Called on a timer. Deadlines, bots and disconnects are all handled here, so none of them depend on an in-process timer per match. */
  sweep(): void {
    const now = this.now();
    for (const l of [...this.live.values()]) {
      if (l.finalized) {
        if (l.finalizedAt !== null && now - l.finalizedAt > 10 * 60_000) this.live.delete(l.id);
        continue;
      }
      let changed = this.advance(l, now);
      for (const seat of [0, 1] as Seat[]) {
        const tier = l.bots[seat];
        if (tier && now >= l.botNextAt[seat] && l.state.phase !== "review") {
          const intent = botStep(viewFor(l.state, seat), l.rng[seat], tier, l.memo[seat]);
          if (intent) {
            const r = apply(l.state, seat, intent, now);
            if (r.ok) { l.rec.intent(seat, intent, now); l.state = r.state; changed = true; }
            l.botNextAt[seat] = now + this.botDelayMs;
          }
        }
        const gone = l.disconnectedAt[seat];
        if (!tier && gone !== null && now - gone > this.graceMs && l.state.phase !== "review") {
          const r = apply(l.state, seat, { k: "forfeit" }, now);
          if (r.ok) { l.rec.intent(seat, { k: "forfeit" }, now); l.state = r.state; changed = true; }
        }
      }
      if (changed) this.afterChange(l);
    }
  }

  /* ------------------------------------------------------------------ persistence */
  private persist(l: Live): void {
    if (l.finalized) return;
    this.store.saveLive({
      id: l.id, config: JSON.stringify(l.config), state: JSON.stringify(l.state), moves: JSON.stringify(l.rec.moves),
      user0: l.users[0], user1: l.users[1], mode: l.config.mode, updatedAt: this.now(),
    });
  }

  /**
   * Resume after a restart. Deadlines live inside the state, so a five-minute build phase that spans a
   * deploy simply carries on, and the sweeper handles anything that expired while the server was down.
   */
  restore(): number {
    let n = 0;
    for (const row of this.store.allLive()) {
      if (this.live.has(row.id)) continue;
      const config = JSON.parse(row.config) as MatchConfig;
      const state = JSON.parse(row.state) as MatchState;
      if (state.phase === "review") { this.store.deleteLive(row.id); continue; }
      const rec = new MoveRecorder(config);
      for (const m of JSON.parse(row.moves) as MoveLog["moves"]) rec.moves.push(m);
      const botSeat: Seat | null = row.user1 === null ? 1 : row.user0 === null ? 0 : null;
      const tier: BotTier = "normal";
      const now = this.now();
      this.live.set(row.id, {
        id: row.id, config, state, rec, users: [row.user0, row.user1],
        bots: [botSeat === 0 ? tier : null, botSeat === 1 ? tier : null], memo: [{}, {}],
        rng: [makeRng(config.seed + 11), makeRng(config.seed + 22)], botNextAt: [now, now],
        everAttached: [state.seats[0].ready, state.seats[1].ready], connected: [false, false],
        disconnectedAt: [now, now], startedAt: row.updatedAt, finalized: false, finalizedAt: null,
      });
      n++;
    }
    return n;
  }

  /* ------------------------------------------------------------------ results */
  private finalize(l: Live): void {
    l.finalized = true; l.finalizedAt = this.now();
    const s = l.state;
    const log = l.rec.finish(s);
    const check = verifyReplay(log);
    if (!check.ok) this.emit("error", new Error(`match ${l.id} failed its own replay check: ${check.reason}`));
    const winner = s.result?.winner ?? "draw";
    let change: [number, number] = [0, 0];
    const [u0, u1] = [l.users[0] ? this.store.user(l.users[0]) : null, l.users[1] ? this.store.user(l.users[1]) : null];
    if (l.config.mode === "pvp" && u0 && u1) {
      const score = winner === "draw" ? 0.5 : winner === 0 ? 1 : 0;
      const d = eloChange(u0.elo, u1.elo, score);
      change = [d.a, d.b];
      this.store.applyResult(u0.id, d.a, winner === "draw" ? "draw" : winner === 0 ? "win" : "loss");
      this.store.applyResult(u1.id, d.b, winner === "draw" ? "draw" : winner === 1 ? "win" : "loss");
    }
    if (l.config.mode === "daily" && u0) {
      const day = dailyInfo(l.startedAt).day;
      const won = winner === 0 ? 1 : 0;
      const spent = designCost(s.seats[0].design);
      const score = Math.round(s.seats[0].hp * 10 + won * 500 + Math.max(0, 700 - spent));
      this.store.saveDaily({ day, userId: u0.id, handle: u0.handle, score, hp: s.seats[0].hp, spent, won, matchId: l.id });
    }
    this.store.saveMatch({
      id: l.id, mode: l.config.mode, seed: l.config.seed, scenarioId: l.config.scenarioId,
      handle0: s.seats[0].handle, handle1: s.seats[1].handle, user0: l.users[0], user1: l.users[1],
      winner: String(winner), reason: s.result?.reason ?? "even", log: JSON.stringify(log),
      startedAt: l.startedAt, endedAt: this.now(), eloChange0: change[0], eloChange1: change[1],
    });
    this.store.deleteLive(l.id);
  }
}
