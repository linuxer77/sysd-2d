import type { ReactNode } from "react";
import type { Session } from "../../session/types";
import type { PlayerView } from "@sysd/match";
import { Icon } from "../../icons/Icon";
import { useApp } from "../../state/store";

export interface MatchProps { session: Session; v: PlayerView; now: number }

/** The "what do I do right now" strip that opens every phase. */
export function Guide({ title, children, tone = "info" }: { title: string; children: ReactNode; tone?: "info" | "warn" }) {
  return (
    <div className={`banner ${tone === "warn" ? "warn" : ""}`} style={{ alignItems: "flex-start", background: tone === "warn" ? undefined : "linear-gradient(90deg, color-mix(in srgb, var(--c-cyan) 8%, transparent), transparent)" }}>
      <span style={{ color: tone === "warn" ? "var(--warn)" : "var(--c-cyan)", marginTop: 2 }}><Icon name="BULB" size={16} /></span>
      <div><b style={{ color: "var(--text)" }}>{title}</b><div style={{ color: "var(--text-2)", fontSize: 12.5 }}>{children}</div></div>
    </div>
  );
}

export const PHASE_LABEL: Record<string, string> = { lobby: "waiting", brief: "the problem", draft: "draft", build: "build", recon: "scout", siege: "siege", review: "review" };

export async function send(session: Session, intent: Parameters<Session["send"]>[0]): Promise<boolean> {
  const r = await session.send(intent);
  if (!r.ok) { useApp.getState().say(r.reason); return false; }
  return true;
}
