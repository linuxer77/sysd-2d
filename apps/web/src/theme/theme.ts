import { useSyncExternalStore } from "react";
import { DEFAULT_THEME, THEMES, themeById, type Theme } from "./themes";

let current = DEFAULT_THEME;
let version = 0;
const listeners = new Set<() => void>();
const cache = new Map<string, string>();
let probe: HTMLElement | null = null;

export function applyTheme(id: string): void {
  const t = themeById(id);
  current = t.id;
  const root = document.documentElement;
  for (const [k, v] of Object.entries(t.vars)) root.style.setProperty(k, v);
  root.setAttribute("data-theme", t.id);
  try { localStorage.setItem("siege.theme", t.id); } catch { /* private window: carry on */ }
  version += 1; cache.clear();
  listeners.forEach((l) => l());
}

export function initTheme(): void {
  let id = DEFAULT_THEME;
  try { const v = localStorage.getItem("siege.theme"); if (v && THEMES.some((t) => t.id === v)) id = v; } catch { /* ignore */ }
  applyTheme(id);
}

export const currentTheme = (): Theme => themeById(current);
export const themeVersion = (): number => version;
export function useTheme(): Theme {
  useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => version);
  return themeById(current);
}

/**
 * Canvas cannot read CSS variables, so turn "var(--c-red)" (or any CSS colour) into a real colour the
 * canvas understands, once per theme. Plain colours pass straight through.
 */
export function resolveColor(expr: string): string {
  if (!expr.includes("var(")) return expr;
  const hit = cache.get(expr);
  if (hit) return hit;
  if (!probe) { probe = document.createElement("span"); probe.style.display = "none"; document.body.appendChild(probe); }
  probe.style.color = ""; probe.style.color = expr;
  const out = getComputedStyle(probe).color || "#c0caf5";
  cache.set(expr, out);
  return out;
}

/** The named colours the board uses, resolved for the current theme. */
export interface Palette {
  bg: string; hl: string; sel: string; selBorder: string; border: string; grid: string; edge: string;
  fg: string; fg2: string; dim: string; blue: string; cyan: string; teal: string; green: string; yellow: string; orange: string; red: string; purple: string; magenta: string;
}
export function palette(): Palette {
  const r = (n: string): string => resolveColor(`var(--${n})`);
  return {
    bg: r("c-bg"), hl: r("c-hl"), sel: r("c-sel"), selBorder: r("c-sel-border"), border: r("c-border"), grid: r("c-grid"), edge: r("c-edge"),
    fg: r("c-fg"), fg2: r("c-fg-2"), dim: r("c-dim"), blue: r("c-blue"), cyan: r("c-cyan"), teal: r("c-teal"), green: r("c-green"),
    yellow: r("c-yellow"), orange: r("c-orange"), red: r("c-red"), purple: r("c-purple"), magenta: r("c-magenta"),
  };
}
