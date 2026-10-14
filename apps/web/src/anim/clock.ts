/** The one animation loop in the app. Anything that needs a frame subscribes here, nothing else calls requestAnimationFrame. */
type Sub = (dt: number, now: number) => void;
const subs = new Set<Sub>();
let raf = 0, last = 0;

function frame(now: number): void {
  const dt = Math.min(50, now - (last || now));       // a backgrounded tab must not teleport particles
  last = now;
  for (const s of subs) s(dt, now);
  raf = subs.size ? requestAnimationFrame(frame) : 0;
  if (!subs.size) last = 0;
}
export function subscribeFrame(fn: Sub): () => void {
  subs.add(fn);
  if (!raf) raf = requestAnimationFrame(frame);
  return () => { subs.delete(fn); };
}
