/** One switch for motion: the player's choice, falling back to the operating system's setting. */
export type MotionPref = "auto" | "full" | "reduced";
let pref: MotionPref = "auto";
const listeners = new Set<() => void>();

const systemReduced = (): boolean => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
export const motionEnabled = (): boolean => (pref === "full" ? true : pref === "reduced" ? false : !systemReduced());

export function setMotion(p: MotionPref): void {
  pref = p;
  try { localStorage.setItem("siege.motion", p); } catch { /* private window: carry on */ }
  document.documentElement.setAttribute("data-motion", p === "auto" ? (systemReduced() ? "reduced" : "full") : p);
  listeners.forEach((l) => l());
}
export function initMotion(): void {
  let p: MotionPref = "auto";
  try { const v = localStorage.getItem("siege.motion"); if (v === "full" || v === "reduced" || v === "auto") p = v; } catch { /* ignore */ }
  setMotion(p);
}
export const getMotion = (): MotionPref => pref;
export const onMotionChange = (fn: () => void): (() => void) => { listeners.add(fn); return () => listeners.delete(fn); };
