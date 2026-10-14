import { createServer as createHttpServer } from "node:http";
import { randomInt } from "node:crypto";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { Server as IoServer, type Socket } from "socket.io";
import { parseIntent, type BotTier, type Durations } from "@sysd/match";
import { findPairs, type QueueEntry } from "./matchmaking.js";
import { Runtime, dailyInfo } from "./runtime.js";
import { Store, type User } from "./store.js";

export interface ServerOptions {
  dbPath?: string;
  clock?: () => number;
  durations?: Partial<Durations>;
  botDelayMs?: number;
  disconnectGraceMs?: number;
  sweepMs?: number;
  matchmakingMs?: number;
  /** serve the built web app from this folder, so one process runs the whole game */
  staticDir?: string;
}

const HANDLE_RE = /^[A-Za-z0-9_-]{3,16}$/;
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const newCode = (): string => Array.from({ length: 5 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
const publicUser = (u: User) => ({ id: u.id, handle: u.handle, elo: u.elo, games: u.games, wins: u.wins, losses: u.losses, draws: u.draws });

export function createServer(opts: ServerOptions = {}) {
  const store = new Store(opts.dbPath ?? ":memory:");
  const runtime = new Runtime({
    store,
    ...(opts.clock ? { clock: opts.clock } : {}),
    ...(opts.durations ? { durations: opts.durations } : {}),
    ...(opts.botDelayMs !== undefined ? { botDelayMs: opts.botDelayMs } : {}),
    ...(opts.disconnectGraceMs !== undefined ? { disconnectGraceMs: opts.disconnectGraceMs } : {}),
  });
  runtime.on("error", (e: Error) => app.log.error(e));

  const httpServer = createHttpServer();
  const app = Fastify({ logger: false, serverFactory: (handler) => { httpServer.on("request", handler); return httpServer; } });
  void app.register(cors, { origin: true });
  if (opts.staticDir && existsSync(opts.staticDir)) void app.register(fastifyStatic, { root: opts.staticDir });
  const io = new IoServer(httpServer, { cors: { origin: true }, transports: ["websocket"] });

  const authUser = (header: string | undefined): User | null => {
    const m = /^Bearer (.+)$/.exec(header ?? "");
    return m ? store.userByToken(m[1] as string) : null;
  };

  /* ---------------------------------------------------------------- HTTP */
  app.get("/api/health", async () => ({ ok: true }));

  app.post("/api/guest", async (req, reply) => {
    const handle = String((req.body as { handle?: unknown } | null)?.handle ?? "").trim();
    if (!HANDLE_RE.test(handle)) return reply.code(400).send({ error: "Pick a name of 3 to 16 letters, numbers, dashes or underscores." });
    const r = store.createGuest(handle, runtime.now());
    if ("error" in r) return reply.code(409).send({ error: "That name is taken. Try another." });
    return { token: r.token, user: publicUser(r.user) };
  });
  app.get("/api/me", async (req, reply) => {
    const u = authUser(req.headers.authorization);
    return u ? publicUser(u) : reply.code(401).send({ error: "Sign in first." });
  });
  app.get("/api/leaderboard", async () => store.leaderboard(50).map(publicUser));
  app.get("/api/daily", async () => {
    const d = dailyInfo(runtime.now());
    return { ...d, board: store.dailyBoard(d.day, 25) };
  });
  app.get("/api/history", async (req, reply) => {
    const u = authUser(req.headers.authorization);
    return u ? store.history(u.id) : reply.code(401).send({ error: "Sign in first." });
  });
  /** Public: anyone can fetch a finished match and re-run it to check the result. */
  app.get("/api/matches/:id", async (req, reply) => {
    const m = store.match((req.params as { id: string }).id);
    if (!m) return reply.code(404).send({ error: "No such match." });
    return { ...m, log: JSON.parse(m.log) };
  });

  /* ---------------------------------------------------------------- sockets */
  const sockets = new Map<string, Set<Socket>>();                 // user id -> live connections
  const rooms = new Map<string, { host: string; createdAt: number }>();
  const queue = new Map<string, QueueEntry>();

  const emitView = (matchId: string): void => {
    const l = runtime.get(matchId);
    if (!l) return;
    for (const seat of [0, 1] as const) {
      const uid = l.users[seat];
      if (!uid) continue;
      const v = runtime.view(matchId, seat);
      for (const sk of sockets.get(uid) ?? []) sk.emit("view", { view: v, serverNow: runtime.now() });
    }
  };
  runtime.on("update", emitView);

  const bind = (matchId: string, userIds: string[]): void => {
    for (const uid of userIds) for (const sk of sockets.get(uid) ?? []) sk.emit("match:found", { matchId });
  };

  io.use((socket, next) => {
    const token = (socket.handshake.auth as { token?: string } | undefined)?.token;
    const u = token ? store.userByToken(token) : null;
    if (!u) return next(new Error("Sign in first."));
    socket.data.userId = u.id;
    next();
  });

  io.on("connection", (socket) => {
    const uid = socket.data.userId as string;
    const set = sockets.get(uid) ?? new Set<Socket>();
    set.add(socket); sockets.set(uid, set);

    // a returning player is handed back to the match they were in
    const active = runtime.activeMatchOf(uid);
    if (active) {
      const seat = runtime.seatOf(active, uid);
      if (seat !== null) { runtime.attach(active, seat, true); socket.emit("match:found", { matchId: active }); }
    }

    const busy = (): string | null => runtime.activeMatchOf(uid);
    type Ack = (r: unknown) => void;

    socket.on("room:create", (_p: unknown, ack?: Ack) => {
      if (busy()) return ack?.({ ok: false, reason: "You are already in a match." });
      for (const [c, r] of rooms) if (r.host === uid) rooms.delete(c);
      let code = newCode(); while (rooms.has(code)) code = newCode();
      rooms.set(code, { host: uid, createdAt: runtime.now() });
      queue.delete(uid);
      ack?.({ ok: true, code });
    });
    socket.on("room:cancel", () => { for (const [c, r] of rooms) if (r.host === uid) rooms.delete(c); });
    socket.on("room:join", (p: { code?: string }, ack?: Ack) => {
      const code = String(p?.code ?? "").toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) return ack?.({ ok: false, reason: "That room code does not exist. Check it and try again." });
      if (room.host === uid) return ack?.({ ok: false, reason: "That is your own room. Share the code with a friend." });
      if (busy()) return ack?.({ ok: false, reason: "You are already in a match." });
      const host = store.user(room.host), guest = store.user(uid);
      if (!host || !guest || !(sockets.get(host.id)?.size)) { rooms.delete(code); return ack?.({ ok: false, reason: "The host has left. Ask them for a new code." }); }
      rooms.delete(code);
      const matchId = runtime.create({ mode: "pvp", users: [host, guest] });
      bind(matchId, [host.id, guest.id]);
      ack?.({ ok: true, matchId });
    });

    socket.on("queue:join", (_p: unknown, ack?: Ack) => {
      if (busy()) return ack?.({ ok: false, reason: "You are already in a match." });
      const u = store.user(uid);
      if (!u) return ack?.({ ok: false, reason: "Sign in first." });
      queue.set(uid, { userId: uid, elo: u.elo, since: runtime.now() });
      ack?.({ ok: true });
    });
    socket.on("queue:leave", () => { queue.delete(uid); });

    socket.on("practice:start", (p: { tier?: BotTier; daily?: boolean }, ack?: Ack) => {
      if (busy()) return ack?.({ ok: false, reason: "You are already in a match." });
      const u = store.user(uid);
      if (!u) return ack?.({ ok: false, reason: "Sign in first." });
      const tier: BotTier = p?.tier === "easy" || p?.tier === "hard" ? p.tier : "normal";
      const day = dailyInfo(runtime.now());
      const matchId = p?.daily
        ? runtime.create({ mode: "daily", users: [u, null], botTier: "hard", seed: day.seed, scenarioId: day.scenarioId })
        : runtime.create({ mode: "practice", users: [u, null], botTier: tier });
      bind(matchId, [uid]);
      ack?.({ ok: true, matchId });
    });

    socket.on("match:attach", (p: { matchId?: string }, ack?: Ack) => {
      const id = String(p?.matchId ?? "");
      const seat = runtime.seatOf(id, uid);
      if (seat === null) return ack?.({ ok: false, reason: "You are not part of that match." });
      runtime.attach(id, seat, true);
      emitView(id);
      ack?.({ ok: true, seat });
    });

    socket.on("intent", (p: { matchId?: string; intent?: unknown }, ack?: Ack) => {
      const id = String(p?.matchId ?? "");
      const seat = runtime.seatOf(id, uid);
      if (seat === null) return ack?.({ ok: false, reason: "You are not part of that match." });
      const parsed = parseIntent(p?.intent);
      if (!parsed.ok) return ack?.({ ok: false, reason: "That action was not understood." });
      ack?.(runtime.submit(id, seat, parsed.intent));
    });

    socket.on("disconnect", () => {
      set.delete(socket);
      if (set.size === 0) {
        sockets.delete(uid);
        queue.delete(uid);
        for (const [c, r] of rooms) if (r.host === uid) rooms.delete(c);
        const m = runtime.activeMatchOf(uid);
        if (m) { const seat = runtime.seatOf(m, uid); if (seat !== null) runtime.attach(m, seat, false); }
      }
    });
  });

  /* ---------------------------------------------------------------- background loops */
  const timers: NodeJS.Timeout[] = [];
  const start = (): void => {
    timers.push(setInterval(() => runtime.sweep(), opts.sweepMs ?? 250));
    timers.push(setInterval(() => {
      const now = runtime.now();
      for (const [a, b] of findPairs([...queue.values()], now)) {
        queue.delete(a.userId); queue.delete(b.userId);
        const ua = store.user(a.userId), ub = store.user(b.userId);
        if (!ua || !ub) continue;
        const matchId = runtime.create({ mode: "pvp", users: [ua, ub] });
        bind(matchId, [ua.id, ub.id]);
      }
      for (const [c, r] of rooms) if (now - r.createdAt > 30 * 60_000) rooms.delete(c);
    }, opts.matchmakingMs ?? 1000));
    for (const t of timers) t.unref();
  };

  return {
    app, io, runtime, store, httpServer,
    async listen(port = 0, host = "127.0.0.1"): Promise<number> {
      runtime.restore();
      await app.ready();
      await new Promise<void>((res) => httpServer.listen(port, host, res));
      start();
      const addr = httpServer.address();
      return typeof addr === "object" && addr ? addr.port : port;
    },
    async close(): Promise<void> {
      for (const t of timers) clearInterval(t);
      await io.close();
      await app.close();
      store.close();
    },
  };
}
