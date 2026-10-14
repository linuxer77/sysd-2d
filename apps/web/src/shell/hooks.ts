import { useEffect, useState, useSyncExternalStore } from "react";
import type { Session, Snapshot } from "../session/types";
import { RemoteSession } from "../session/api";

export function useSnapshot(s: Session): Snapshot | null {
  return useSyncExternalStore((cb) => s.subscribe(cb), () => s.snapshot());
}

/** A ticking "now" that follows the server's clock for live matches. */
export function useClock(session: Session | null, everyMs = 250): number {
  const read = (): number => (session instanceof RemoteSession ? session.serverNowEstimate() : Date.now());
  const [now, setNow] = useState(read);
  useEffect(() => { const t = setInterval(() => setNow(read()), everyMs); return () => clearInterval(t); }, [session, everyMs]);
  return now;
}

export function useMedia(query: string): boolean {
  const [m, setM] = useState(() => typeof matchMedia !== "undefined" && matchMedia(query).matches);
  useEffect(() => { const mq = matchMedia(query); const f = (): void => setM(mq.matches); mq.addEventListener("change", f); f(); return () => mq.removeEventListener("change", f); }, [query]);
  return m;
}
