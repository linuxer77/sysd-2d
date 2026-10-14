# sysd-2d

A free game about keeping a website standing. It is a tower defence with a roguelike run: you build a service out of
pieces (servers, caches, databases and more), then survive eight waves of visitors that each bring a different problem.
After every wave you pick a reward, and the run ends when too many visitors have been failed. A deterministic simulator
decides every outcome. Nothing is scripted or rolled, so a loss always has a reason you can see and fix.

Anyone can play. All in-game text is plain language with no abbreviations, and every wave card says what is coming
and what helps. The older versus modes (against the computer, against a friend, daily challenge) are still in the
repository and reachable from "Other ways to play" on the front page; they return later as a duel built on the same rules.

## Run it

```sh
pnpm install
pnpm build          # builds the web app
pnpm start          # one process: the game server and the web app, on http://localhost:8787
```

Open http://localhost:8787. Playing against the computer works with no server at all.

For development with hot reload (the simulator reloads in the browser with no build step):

```sh
pnpm dev            # server on 8787, web app on http://localhost:5173
```

Environment: `PORT`, `HOST`, `DB_PATH` (default `siege.sqlite`), `STATIC_DIR`.

## Layout

| Path | What it is |
|---|---|
| `packages/sim` | The simulator. Pure and deterministic: no clock, no randomness, no DOM. |
| `packages/shared` | Balance data (pieces, attacks, scenario) and all player-facing content: coach, guided missions, glossary. |
| `packages/match` | The match rules as one pure reducer: draft, build, scout, siege, review. Fog of war, the bot, replays. |
| `packages/run` | The run mode as one pure reducer: waves, money, rewards, the forecast, replays. Built on the simulator. |
| `apps/server` | Rooms, ranked queue, accounts, ratings, history, replays. Fastify and Socket.IO. SQLite storage. |
| `apps/web` | The browser game. React and a hand-written canvas. |
| `tools/balance` | Archetype designs, the balance sweep, and the engine's test suites. |
| `tools/e2e` | Browser end-to-end scripts (need `playwright-core` and a local Chromium). |
| `docs/prototype` | The original single-file prototype, kept as the art reference. |

## Commands

```sh
pnpm test        # 207 tests: golden snapshots, determinism, match rules, server, copy rules
pnpm typecheck
pnpm balance     # sweep every affordable design against every attack
pnpm e2e         # play a full match in a real browser (server and web app must be running)
```

## Rules this project enforces with tests

- The simulator uses no ambient globals and no transcendental math, so the browser and the server always agree.
- Packages depend on each other in one direction only.
- Nothing a player reads contains an abbreviation. This is checked in the shared content, the coach, the match
  narration, and by parsing every screen's source.
- A finished match can be replayed move for move, and a tampered replay is rejected.
