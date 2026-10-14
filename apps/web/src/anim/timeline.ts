import { motionEnabled } from "./motion";

/**
 * A storyboard: steps at absolute millisecond offsets. `visual` steps are decoration; `commit` steps
 * change what the player is shown as true. skip() drops every visual step and runs every commit step
 * immediately, in order: ONE code path for reduced motion, click-to-skip and fast-forward, and
 * nothing can drift out of sync because state changes never live inside a decoration.
 */
interface Step { at: number; fn: () => void; commit: boolean }

export class Timeline {
  private steps: Step[] = [];
  private idx = 0;
  private t = 0;
  private done = false;
  private ready = false;
  private cb: (() => void)[] = [];

  at(ms: number, fn: () => void): this { this.steps.push({ at: ms, fn, commit: false }); return this; }
  commit(ms: number, fn: () => void): this { this.steps.push({ at: ms, fn, commit: true }); return this; }
  stagger<T>(ms: number, items: readonly T[], gap: number, fn: (x: T) => void): this { items.forEach((x, i) => this.at(ms + i * gap, () => fn(x))); return this; }
  onDone(fn: () => void): this { this.cb.push(fn); return this; }
  get finished(): boolean { return this.done; }

  private prep(): void {
    if (this.ready) return;
    this.steps.sort((a, b) => a.at - b.at);      // stable, so steps at the same time keep the order they were added
    this.ready = true;
  }
  /** Advance by dt milliseconds. Returns true once everything has run. */
  tick(dt: number): boolean {
    if (this.done) return true;
    this.prep();
    this.t += dt;
    while (this.idx < this.steps.length && (this.steps[this.idx] as Step).at <= this.t) (this.steps[this.idx++] as Step).fn();
    if (this.idx >= this.steps.length) this.finish();
    return this.done;
  }
  /** Drop the decoration, keep the truth. */
  skip(): void {
    if (this.done) return;
    this.prep();
    for (; this.idx < this.steps.length; this.idx++) { const s = this.steps[this.idx] as Step; if (s.commit) s.fn(); }
    this.finish();
  }
  private finish(): void { this.done = true; for (const c of this.cb) c(); }
}

/** Play now, or settle instantly when motion is off. */
export function play(tl: Timeline, registry: Set<Timeline>): void {
  if (!motionEnabled()) { tl.skip(); return; }
  registry.add(tl);
}
