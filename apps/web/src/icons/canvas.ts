import { ICON_D, type IconName } from "./paths";
import { resolveColor } from "../theme/theme";

const cache = new Map<IconName, Path2D>();
const path = (n: IconName): Path2D => { let p = cache.get(n); if (!p) { p = new Path2D(ICON_D[n]); cache.set(n, p); } return p; };

/** Canvas renderer: identical geometry to the DOM one, because it is the same path string. */
export function drawIcon(c: CanvasRenderingContext2D, name: IconName, cx: number, cy: number, size: number, color: string, alpha = 1, dash?: number): void {
  c.save();
  c.globalAlpha = alpha;
  c.translate(cx - size / 2, cy - size / 2);
  c.scale(size / 24, size / 24);
  c.strokeStyle = resolveColor(color); c.lineWidth = 1.6 * (24 / size);       // a constant 1.6 pixel stroke at any size
  c.lineCap = "round"; c.lineJoin = "round";
  if (dash !== undefined) { c.setLineDash([60, 60]); c.lineDashOffset = 60 * (1 - dash); }
  c.stroke(path(name));
  c.restore();
}
