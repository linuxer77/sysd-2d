/** The same curves as the CSS motion tokens, so DOM transitions and canvas tweens feel like one system. */
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const clamp = (x: number, lo = 0, hi = 1): number => (x < lo ? lo : x > hi ? hi : x);

export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = (t: number) => ((ax * t + bx) * t + cx) * t;
  const Y = (t: number) => ((ay * t + by) * t + cy) * t;
  const dX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0; if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) { const e = X(t) - x; if (Math.abs(e) < 1e-5) break; const d = dX(t); if (Math.abs(d) < 1e-6) break; t -= e / d; }
    return Y(clamp(t));
  };
}
export const ease = {
  linear: (t: number) => t,
  out: cubicBezier(0.22, 1, 0.36, 1),
  snap: cubicBezier(0.2, 0.9, 0.3, 1),
  overshoot: cubicBezier(0.34, 1.56, 0.64, 1),
  impact: cubicBezier(0.12, 0.84, 0.2, 1),
  inOut: cubicBezier(0.65, 0, 0.35, 1),
  in: cubicBezier(0.55, 0, 1, 0.45),
};
