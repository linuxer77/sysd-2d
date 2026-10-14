import { useCallback, useEffect, useState } from "react";
import { apply, createRun, type Intent, type RunState } from "@sysd/run";

const KEY = "sysd.run.v1", BEST = "sysd.run.best";

export interface Best { waves: number; won: boolean }

function load(): RunState | null {
  try {
    const raw = localStorage.getItem(KEY); if (!raw) return null;
    const s = JSON.parse(raw) as RunState;
    return s && typeof s.seed === "number" && Array.isArray(s.waves) && s.design && s.phase ? s : null;
  } catch { return null; }
}
const save = (s: RunState): void => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private window */ } };
export const loadBest = (): Best | null => { try { const v = localStorage.getItem(BEST); return v ? (JSON.parse(v) as Best) : null; } catch { return null; } };
const saveBest = (b: Best): void => { try { localStorage.setItem(BEST, JSON.stringify(b)); } catch { /* private window */ } };

/** Is there a run in progress that the front page can offer to continue? */
export const hasRunInProgress = (): boolean => { const s = load(); return !!s && s.phase !== "over"; };
export const clearRun = (): void => { try { localStorage.removeItem(KEY); } catch { /* private window */ } };
const freshSeed = (): number => Math.floor(Math.random() * 2_000_000_000);

export function useRun() {
  const [state, setState] = useState<RunState>(() => { const s = load(); return s && s.phase !== "over" ? s : createRun(freshSeed()); });
  useEffect(() => { save(state); }, [state]);
  useEffect(() => {
    if (state.phase !== "over") return;
    const waves = state.outcome === "won" ? state.waves.length : Math.max(0, state.history.length - 1);
    const prev = loadBest();
    if (!prev || waves > prev.waves || (state.outcome === "won" && !prev.won)) saveBest({ waves, won: state.outcome === "won" });
  }, [state.phase, state.outcome, state.history.length, state.waves.length]);

  /** Returns the reason a move was refused, in plain words, or null when it worked. */
  const send = useCallback((i: Intent): string | null => {
    let why: string | null = null;
    setState((cur) => { const r = apply(cur, i); if (r.ok) return r.state; why = r.reason; return cur; });
    return why;
  }, []);
  const restart = useCallback(() => setState(createRun(freshSeed())), []);
  return { state, send, restart };
}
