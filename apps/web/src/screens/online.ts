import type { Connection } from "../session/api";
import { useApp } from "../state/store";

/** Ask the server to start a match against its own bot (so the result can count for the daily board). */
export async function createServerPractice(conn: Connection, opts: { daily?: boolean; tier?: "easy" | "normal" | "hard" }): Promise<void> {
  const r = await conn.call<{ ok: boolean; reason?: string }>("practice:start", opts);
  if (!r.ok) useApp.getState().say(r.reason ?? "The match could not be started.");
}
