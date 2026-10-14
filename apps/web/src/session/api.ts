import { io, type Socket } from "socket.io-client";
import type { Intent, MoveLog, PlayerView, Seat } from "@sysd/match";
import type { SendResult, Session, Snapshot } from "./types";

/**
 * Where the game server is. Served by the server itself: the same origin (empty string). Running the
 * Vite dev server on its own: the server on port 8787 of the same machine. Opened as a plain file: nowhere,
 * and the game simply plays offline.
 */
export const SERVER_URL: string =
  (import.meta.env.VITE_SERVER_URL as string | undefined) ??
  (typeof location === "undefined" || location.protocol === "file:" ? "" : location.port === "5173" ? `http://${location.hostname}:8787` : "");
const HAS_SERVER = typeof location !== "undefined" && location.protocol !== "file:";

export interface Account { token: string; user: PublicUser }
export interface PublicUser { id: string; handle: string; elo: number; games: number; wins: number; losses: number; draws: number }
export interface DailyInfo { day: string; seed: number; board: { handle: string; score: number; hp: number; spent: number; won: number }[] }
export interface HistoryRow { id: string; mode: string; handle0: string; handle1: string; winner: string; reason: string; endedAt: number; eloChange0: number; eloChange1: number; user0: string | null; user1: string | null }

const json = async <T,>(r: Response): Promise<T> => { const j = await r.json(); if (!r.ok) throw new Error((j as { error?: string }).error ?? "Something went wrong."); return j as T; };
const auth = (t: string): HeadersInit => ({ authorization: `Bearer ${t}` });

export const api = {
  async health(): Promise<boolean> {
    if (!HAS_SERVER) return false;
    try { const r = await fetch(`${SERVER_URL}/api/health`, { signal: AbortSignal.timeout(2500) }); return r.ok; } catch { return false; }
  },
  guest: (handle: string) => fetch(`${SERVER_URL}/api/guest`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ handle }) }).then((r) => json<Account>(r)),
  me: (t: string) => fetch(`${SERVER_URL}/api/me`, { headers: auth(t) }).then((r) => json<PublicUser>(r)),
  leaderboard: () => fetch(`${SERVER_URL}/api/leaderboard`).then((r) => json<PublicUser[]>(r)),
  daily: () => fetch(`${SERVER_URL}/api/daily`).then((r) => json<DailyInfo>(r)),
  history: (t: string) => fetch(`${SERVER_URL}/api/history`, { headers: auth(t) }).then((r) => json<HistoryRow[]>(r)),
  match: (id: string) => fetch(`${SERVER_URL}/api/matches/${id}`).then((r) => json<{ log: MoveLog; handle0: string; handle1: string }>(r)),
};

/** One live connection to the server: rooms, the ranked queue, practice on the server, and the matches they create. */
export class Connection {
  readonly socket: Socket;
  private foundCb: ((id: string) => void) | null = null;
  constructor(token: string) {
    this.socket = io(SERVER_URL, { auth: { token }, transports: ["websocket"], reconnectionDelay: 800 });
    this.socket.on("match:found", (p: { matchId: string }) => this.foundCb?.(p.matchId));
  }
  onFound(cb: (matchId: string) => void): void { this.foundCb = cb; }
  call<T = { ok: boolean; reason?: string }>(event: string, payload: unknown = {}): Promise<T> {
    return new Promise((res) => this.socket.timeout(8000).emit(event, payload, (err: unknown, r: T) => res(err ? ({ ok: false, reason: "The server did not answer. Check your connection." } as T) : r)));
  }
  onStatus(cb: (up: boolean) => void): void { this.socket.on("connect", () => cb(true)); this.socket.on("disconnect", () => cb(false)); this.socket.on("connect_error", () => cb(false)); }
  close(): void { this.socket.close(); }
}

/** A match played through the server. The server decides everything; this just shows it and relays intent. */
export class RemoteSession implements Session {
  readonly kind = "remote" as const;
  private snap: Snapshot | null = null;
  private subs = new Set<() => void>();
  private offset = 0;
  seat: Seat = 0;
  private onView = (p: { view: PlayerView; serverNow: number }): void => {
    this.offset = p.serverNow - Date.now();
    this.seat = p.view.seat;
    this.snap = { view: p.view, serverNow: p.serverNow };
    for (const s of this.subs) s();
  };
  constructor(private conn: Connection, readonly matchId: string) {
    conn.socket.on("view", this.onView);
    conn.call("match:attach", { matchId });
  }
  /** the server's clock, so every countdown agrees even if this device's clock is wrong */
  serverNowEstimate(): number { return Date.now() + this.offset; }
  snapshot(): Snapshot | null { return this.snap; }
  subscribe(cb: () => void): () => void { this.subs.add(cb); return () => { this.subs.delete(cb); }; }
  send(intent: Intent): Promise<SendResult> {
    return this.conn.call<{ ok: boolean; reason?: string }>("intent", { matchId: this.matchId, intent })
      .then((r) => (r.ok ? { ok: true as const } : { ok: false as const, reason: r.reason ?? "That did not work." }));
  }
  close(): void { this.conn.socket.off("view", this.onView); this.subs.clear(); }
}
