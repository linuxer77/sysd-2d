import { makeRng, type Rng } from "@sysd/sim";
import {
  MoveRecorder, apply, botStep, createMatch, tick, viewFor,
  type BotMemo, type BotTier, type Intent, type MatchConfig, type MatchState, type MoveLog, type Seat,
} from "@sysd/match";
import type { SendResult, Session, Snapshot } from "./types";

/**
 * A whole match in this browser tab: the same pure match code the server runs, plus a bot. Works with
 * no internet at all. Not ranked, since only the server can vouch for a result.
 */
export class LocalSession implements Session {
  readonly kind = "local" as const;
  readonly seat: Seat = 0;
  readonly matchId: string;
  private state: MatchState;
  private rec: MoveRecorder;
  private subs = new Set<() => void>();
  private snap: Snapshot | null = null;
  private snapKey = "";
  private memo: BotMemo = {};
  private rng: Rng;
  private botAt = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(cfg: MatchConfig, private tier: BotTier, private botDelayMs = 850) {
    this.matchId = cfg.id;
    this.state = createMatch(cfg);
    this.rec = new MoveRecorder(cfg);
    this.rng = makeRng(cfg.seed + 202);
    this.botAt = Date.now() + 600;
    this.submit(0, { k: "ready" });
    this.submit(1, { k: "ready" });
    this.timer = setInterval(() => this.pump(), 200);
  }

  log(): MoveLog { return this.rec.finish(this.state); }

  private submit(seat: Seat, intent: Intent): SendResult {
    const now = Date.now();
    const t = tick(this.state, now);
    if (t !== this.state) { this.rec.tick(now); this.state = t; }
    const r = apply(this.state, seat, intent, now);
    if (!r.ok) return { ok: false, reason: r.reason };
    this.rec.intent(seat, intent, now);
    this.state = r.state;
    this.notify();
    return { ok: true };
  }

  private pump(): void {
    const now = Date.now();
    const t = tick(this.state, now);
    if (t !== this.state) { this.rec.tick(now); this.state = t; this.notify(); }
    if (now >= this.botAt && this.state.phase !== "review") {
      const intent = botStep(viewFor(this.state, 1), this.rng, this.tier, this.memo);
      if (intent) { this.submit(1, intent); this.botAt = Date.now() + this.botDelayMs; }
    }
  }

  snapshot(): Snapshot | null {
    const key = `${this.state.version}:${this.state.deadlineAt}`;
    if (key !== this.snapKey) { this.snapKey = key; this.snap = { view: viewFor(this.state, 0), serverNow: Date.now() }; }
    return this.snap;
  }
  subscribe(cb: () => void): () => void { this.subs.add(cb); return () => { this.subs.delete(cb); }; }
  private notify(): void { for (const s of this.subs) s(); }
  async send(intent: Intent): Promise<SendResult> { return this.submit(0, intent); }
  close(): void { if (this.timer) clearInterval(this.timer); this.timer = null; this.subs.clear(); }
}
