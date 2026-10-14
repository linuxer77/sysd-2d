import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { START_RATING } from "./rating.js";

export interface User { id: string; handle: string; elo: number; games: number; wins: number; losses: number; draws: number; createdAt: number }
export interface MatchRow {
  id: string; mode: string; seed: number; scenarioId: string; handle0: string; handle1: string;
  user0: string | null; user1: string | null; winner: string; reason: string; log: string;
  startedAt: number; endedAt: number; eloChange0: number; eloChange1: number;
}
export interface LiveRow { id: string; config: string; state: string; moves: string; user0: string | null; user1: string | null; mode: string; updatedAt: number }
export interface DailyScore { day: string; userId: string; handle: string; score: number; hp: number; spent: number; won: number; matchId: string }

const hashToken = (t: string): string => createHash("sha256").update(t).digest("hex");

/**
 * Persistence behind one interface. SQLite (built into Node) stands in for Postgres, and live match
 * snapshots stand in for Redis: enough for one server process, and the seam is here when it is not.
 */
export class Store {
  private db: DatabaseSync;
  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      create table if not exists users(
        id text primary key, handle text not null unique collate nocase, token_hash text not null,
        elo integer not null, games integer not null default 0, wins integer not null default 0,
        losses integer not null default 0, draws integer not null default 0, created_at integer not null);
      create table if not exists matches(
        id text primary key, mode text not null, seed integer not null, scenario_id text not null,
        handle0 text not null, handle1 text not null, user0 text, user1 text, winner text not null, reason text not null,
        log text not null, started_at integer not null, ended_at integer not null,
        elo_change0 integer not null default 0, elo_change1 integer not null default 0);
      create index if not exists matches_user0 on matches(user0, ended_at desc);
      create index if not exists matches_user1 on matches(user1, ended_at desc);
      create table if not exists live(
        id text primary key, config text not null, state text not null, moves text not null,
        user0 text, user1 text, mode text not null, updated_at integer not null);
      create table if not exists daily(
        day text not null, user_id text not null, handle text not null, score integer not null, hp integer not null,
        spent integer not null, won integer not null, match_id text not null, primary key(day, user_id));
    `);
  }
  close(): void { this.db.close(); }

  /* ----- accounts */
  createGuest(handle: string, now: number): { user: User; token: string } | { error: "taken" } {
    const exists = this.db.prepare("select 1 from users where handle = ?").get(handle);
    if (exists) return { error: "taken" };
    const id = "u_" + randomBytes(6).toString("hex");
    const token = randomBytes(24).toString("hex");
    this.db.prepare("insert into users(id, handle, token_hash, elo, created_at) values (?,?,?,?,?)")
      .run(id, handle, hashToken(token), START_RATING, now);
    return { user: this.user(id) as User, token };
  }
  userByToken(token: string): User | null {
    const r = this.db.prepare("select * from users where token_hash = ?").get(hashToken(token));
    return r ? rowToUser(r) : null;
  }
  user(id: string): User | null {
    const r = this.db.prepare("select * from users where id = ?").get(id);
    return r ? rowToUser(r) : null;
  }
  leaderboard(limit = 50): User[] {
    return this.db.prepare("select * from users where games > 0 order by elo desc, wins desc limit ?").all(limit).map(rowToUser);
  }
  applyResult(userId: string, delta: number, outcome: "win" | "loss" | "draw"): void {
    this.db.prepare(`update users set elo = elo + ?, games = games + 1,
      wins = wins + ?, losses = losses + ?, draws = draws + ? where id = ?`)
      .run(delta, outcome === "win" ? 1 : 0, outcome === "loss" ? 1 : 0, outcome === "draw" ? 1 : 0, userId);
  }

  /* ----- finished matches */
  saveMatch(m: MatchRow): void {
    this.db.prepare(`insert or replace into matches values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(m.id, m.mode, m.seed, m.scenarioId, m.handle0, m.handle1, m.user0, m.user1, m.winner, m.reason, m.log, m.startedAt, m.endedAt, m.eloChange0, m.eloChange1);
  }
  match(id: string): MatchRow | null {
    const r = this.db.prepare("select * from matches where id = ?").get(id);
    return r ? rowToMatch(r) : null;
  }
  history(userId: string, limit = 30): Omit<MatchRow, "log">[] {
    return this.db.prepare("select * from matches where user0 = ? or user1 = ? order by ended_at desc limit ?")
      .all(userId, userId, limit).map((r) => { const { log: _l, ...rest } = rowToMatch(r); return rest; });
  }

  /* ----- live snapshots: how deadlines outlive the process */
  saveLive(l: LiveRow): void {
    this.db.prepare("insert or replace into live values (?,?,?,?,?,?,?,?)")
      .run(l.id, l.config, l.state, l.moves, l.user0, l.user1, l.mode, l.updatedAt);
  }
  deleteLive(id: string): void { this.db.prepare("delete from live where id = ?").run(id); }
  allLive(): LiveRow[] {
    return this.db.prepare("select * from live").all().map((r) => ({
      id: String(r.id), config: String(r.config), state: String(r.state), moves: String(r.moves),
      user0: (r.user0 as string | null) ?? null, user1: (r.user1 as string | null) ?? null, mode: String(r.mode), updatedAt: Number(r.updated_at),
    }));
  }

  /* ----- the daily challenge */
  saveDaily(d: DailyScore): boolean {
    const prev = this.db.prepare("select score from daily where day = ? and user_id = ?").get(d.day, d.userId);
    if (prev && Number(prev.score) >= d.score) return false;
    this.db.prepare("insert or replace into daily values (?,?,?,?,?,?,?,?)").run(d.day, d.userId, d.handle, d.score, d.hp, d.spent, d.won, d.matchId);
    return true;
  }
  dailyBoard(day: string, limit = 50): DailyScore[] {
    return this.db.prepare("select * from daily where day = ? order by score desc limit ?").all(day, limit).map((r) => ({
      day: String(r.day), userId: String(r.user_id), handle: String(r.handle), score: Number(r.score),
      hp: Number(r.hp), spent: Number(r.spent), won: Number(r.won), matchId: String(r.match_id),
    }));
  }
}

const rowToUser = (r: Record<string, unknown>): User => ({
  id: String(r.id), handle: String(r.handle), elo: Number(r.elo), games: Number(r.games), wins: Number(r.wins),
  losses: Number(r.losses), draws: Number(r.draws), createdAt: Number(r.created_at),
});
const rowToMatch = (r: Record<string, unknown>): MatchRow => ({
  id: String(r.id), mode: String(r.mode), seed: Number(r.seed), scenarioId: String(r.scenario_id),
  handle0: String(r.handle0), handle1: String(r.handle1), user0: (r.user0 as string | null) ?? null, user1: (r.user1 as string | null) ?? null,
  winner: String(r.winner), reason: String(r.reason), log: String(r.log), startedAt: Number(r.started_at), endedAt: Number(r.ended_at),
  eloChange0: Number(r.elo_change0), eloChange1: Number(r.elo_change1),
});
