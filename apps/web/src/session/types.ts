import type { Intent, PlayerView, Seat } from "@sysd/match";

export interface Snapshot { view: PlayerView; serverNow: number }
export type SendResult = { ok: true } | { ok: false; reason: string };

/** What every match screen talks to. It does not care whether the other side is a bot in this tab or a person on a server. */
export interface Session {
  readonly kind: "local" | "remote";
  readonly matchId: string;
  readonly seat: Seat;
  snapshot(): Snapshot | null;
  subscribe(cb: () => void): () => void;
  send(intent: Intent): Promise<SendResult>;
  close(): void;
}
