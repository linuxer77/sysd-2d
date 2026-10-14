import { clamp } from "./easing";
import { motionEnabled } from "./motion";
import { resolveColor } from "../theme/theme";

/** Particles, rings, floating numbers, flashes and screen shake. Drawn on top of a board, in world units. */
interface P { x: number; y: number; vx: number; vy: number; life: number; max: number; r: number; col: string; grav: number }
interface Ring { x: number; y: number; r: number; max: number; col: string; w: number; life: number }
interface Float { x: number; y: number; text: string; col: string; life: number; vy: number; size: number }
interface Beam { x0: number; y0: number; x1: number; y1: number; col: string; life: number; max: number }

export class Fx {
  parts: P[] = []; rings: Ring[] = []; floats: Float[] = []; beams: Beam[] = []; shakeMag = 0;
  flashNode: { id: string; a: number } | null = null;
  get active(): boolean { return this.parts.length + this.rings.length + this.floats.length + this.beams.length > 0 || this.shakeMag > 0.3 || this.flashNode !== null; }

  burst(x: number, y: number, n: number, col: string, speed = 2.4, grav = 0.04): void {
    if (!motionEnabled()) return;
    for (let i = 0; i < Math.min(n, 120); i++) {
      const a = Math.random() * Math.PI * 2, v = speed * (0.3 + Math.random());
      this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 34 + Math.random() * 24, max: 58, r: 1 + Math.random() * 2.4, col, grav });
    }
  }
  ring(x: number, y: number, col: string, max = 140, w = 3): void { if (motionEnabled()) this.rings.push({ x, y, r: 8, max, col, w, life: 1 }); }
  beam(x0: number, y0: number, x1: number, y1: number, col: string, frames = 20): void { if (motionEnabled()) this.beams.push({ x0, y0, x1, y1, col, life: frames, max: frames }); }
  float(x: number, y: number, text: string, col: string, size = 16): void { this.floats.push({ x, y, text, col, life: 70, vy: -1.2, size }); }
  shake(mag: number): void { if (motionEnabled()) this.shakeMag = Math.max(this.shakeMag, mag); }
  flash(id: string): void { if (motionEnabled()) this.flashNode = { id, a: 1 }; }

  /** step by dt milliseconds (normalised to 60 frames per second) */
  tick(dt: number): void {
    const f = dt / 16.67;
    for (const p of this.parts) { p.x += p.vx * f; p.y += p.vy * f; p.vx *= 0.96; p.vy = p.vy * 0.96 + p.grav * f; p.life -= f; }
    this.parts = this.parts.filter((p) => p.life > 0);
    for (const r of this.rings) { r.r += (r.max - r.r) * 0.11 * f; r.life -= 0.028 * f; }
    this.rings = this.rings.filter((r) => r.life > 0);
    for (const t of this.floats) { t.y += t.vy * f; t.vy *= 0.97; t.life -= f; }
    this.floats = this.floats.filter((t) => t.life > 0);
    for (const b of this.beams) b.life -= f;
    this.beams = this.beams.filter((b) => b.life > 0);
    if (this.shakeMag > 0) this.shakeMag *= Math.pow(0.85, f);
    if (this.flashNode) { this.flashNode.a *= Math.pow(0.9, f); if (this.flashNode.a < 0.03) this.flashNode = null; }
  }

  draw(c: CanvasRenderingContext2D): void {
    for (const b of this.beams) {
      const k = b.life / b.max;
      c.save(); c.globalAlpha = k; c.strokeStyle = resolveColor(b.col); c.lineWidth = 6 * k + 1.5; c.lineCap = "round";
      c.shadowColor = resolveColor(b.col); c.shadowBlur = 18;
      c.beginPath(); c.moveTo(b.x0, b.y0); c.lineTo(b.x1, b.y1); c.stroke(); c.restore();
    }
    for (const r of this.rings) {
      c.save(); c.globalAlpha = clamp(r.life) * 0.6; c.strokeStyle = resolveColor(r.col); c.lineWidth = r.w;
      c.beginPath(); c.arc(r.x, r.y, r.r, 0, 7); c.stroke(); c.restore();
    }
    for (const p of this.parts) {
      c.save(); c.globalAlpha = clamp(p.life / (p.max * 0.5)); c.fillStyle = resolveColor(p.col);
      c.beginPath(); c.arc(p.x, p.y, p.r, 0, 7); c.fill(); c.restore();
    }
    for (const t of this.floats) {
      c.save(); c.globalAlpha = clamp(t.life / 30); c.textAlign = "center"; c.textBaseline = "middle";
      c.font = `700 ${t.size}px "JetBrains Mono", monospace`; c.lineWidth = 4; c.strokeStyle = resolveColor("var(--c-bg-dark)");
      c.strokeText(t.text, t.x, t.y); c.fillStyle = resolveColor(t.col); c.fillText(t.text, t.x, t.y); c.restore();
    }
  }
}
