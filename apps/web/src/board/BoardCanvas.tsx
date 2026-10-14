import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { PART_INFO } from "@sysd/shared";
import { WORLD } from "@sysd/match";
import { subscribeFrame } from "../anim/clock";
import { palette, resolveColor } from "../theme/theme";
import { Fx } from "../anim/fx";
import { motionEnabled } from "../anim/motion";
import { drawIcon } from "../icons/canvas";
import { ROLE_COLOR, type IconName } from "../icons/paths";

export interface BoardNode {
  id: string;
  part: IconName | string;
  x: number; y: number;
  /** how full the piece is (0 to above 1). Omit for pieces you cannot see into. */
  util?: number;
  dead?: boolean;
  /** draw a rotating warning ring (an incoming attack is aimed at this piece) */
  marked?: boolean;
  /** draw as hot even though its fullness is unknown (from a previous round's report) */
  hot?: boolean;
}
export interface BoardEdge { from: string; to: string }

export interface BoardHandle {
  toWorld(clientX: number, clientY: number): { x: number; y: number } | null;
  fx: Fx;
}

interface Props {
  nodes: readonly BoardNode[];
  edges: readonly BoardEdge[];
  editable?: boolean;
  selectedId?: string | null;
  /** when set, the board is waiting for the player to choose what to connect this piece to */
  linkFrom?: string | null;
  tag?: string | undefined;
  hint?: string | undefined;
  highlight?: ReadonlySet<string> | undefined;
  onTap?: (id: string | null) => void;
  onMove?: (id: string, x: number, y: number) => void;
  fx?: Fx;
  /** how much traffic each connection carries (0 to 1) and what share of it fails (0 to 1), keyed `from>to`. Failed visitors are red dots that drop out part way along. */
  flow?: { density: Record<string, number>; failing: Record<string, number> };
}

const NW = 104, NH = 86;
const snap = (v: number): number => Math.round(v / 4) * 4;
const clampW = (x: number, y: number): { x: number; y: number } => ({ x: Math.max(NW / 2, Math.min(WORLD.w - NW / 2, x)), y: Math.max(NH / 2, Math.min(WORLD.h - NH / 2, y)) });

function wrap(text: string, max: number): string[] {
  const words = text.split(" "), out: string[] = []; let line = "";
  for (const w of words) { if ((line + " " + w).trim().length > max && line) { out.push(line); line = w; } else line = (line + " " + w).trim(); }
  if (line) out.push(line);
  return out.slice(0, 3);
}

export const BoardCanvas = forwardRef<BoardHandle, Props>(function BoardCanvas(props, ref) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const P = useRef(props); P.current = props;
  const ownFx = useRef(new Fx());
  const fxRef = useRef<Fx>(props.fx ?? ownFx.current); fxRef.current = props.fx ?? ownFx.current;
  const view = useRef({ w: 800, h: 500, dpr: 1, scale: 1, ox: 0, oy: 0 });
  const drag = useRef<null | { id: string; dx: number; dy: number; moved: boolean; x: number; y: number }>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const hover = useRef<string | null>(null);
  const dirty = useRef(true);

  /** On a tall, narrow board (a phone), a view-only graph flows top to bottom instead of left to right. */
  const pt = (n: { x: number; y: number }): { x: number; y: number } =>
    !P.current.editable && view.current.h > view.current.w * 1.15 ? { x: n.y, y: n.x } : { x: n.x, y: n.y };

  /** Editing shows the whole board so pieces can go anywhere. Everything else zooms to fit its pieces, so labels stay readable. */
  const computeView = (): void => {
    const v = view.current, p = P.current;
    const full = Math.min(v.w / WORLD.w, v.h / WORLD.h);
    if (p.editable || p.nodes.length === 0) { v.scale = full; v.ox = (v.w - WORLD.w * full) / 2; v.oy = (v.h - WORLD.h * full) / 2; return; }
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const n of p.nodes) { const q = pt(n); x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
    // padding is in SCREEN pixels so a label near the edge is never clipped, however far the board is zoomed out
    const padX = 64, padTop = 54, padBottom = 78;
    const sx = (v.w - 2 * padX) / Math.max(x1 - x0, 1), sy = (v.h - padTop - padBottom) / Math.max(y1 - y0, 1);
    v.scale = Math.max(Math.min(sx, sy, 1.35), 0.25);
    v.ox = v.w / 2 - ((x0 + x1) / 2) * v.scale;
    v.oy = padTop + (v.h - padTop - padBottom) / 2 - ((y0 + y1) / 2) * v.scale;
  };

  const toWorld = (cx: number, cy: number): { x: number; y: number } | null => {
    const c = canvasRef.current; if (!c) return null;
    const r = c.getBoundingClientRect();
    if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) return null;
    computeView(); const v = view.current;
    return { x: (cx - r.left - v.ox) / v.scale, y: (cy - r.top - v.oy) / v.scale };
  };
  useImperativeHandle(ref, () => ({ toWorld, get fx() { return fxRef.current; } }), []);

  /* ---------- sizing */
  useEffect(() => {
    const el = wrapRef.current, c = canvasRef.current; if (!el || !c) return;
    const fit = (): void => {
      const r = el.getBoundingClientRect(); if (!r.width || !r.height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
      view.current = { w: r.width, h: r.height, dpr, scale: 1, ox: 0, oy: 0 };
      computeView();
      dirty.current = true;
    };
    const ro = new ResizeObserver(fit); ro.observe(el); fit();
    return () => ro.disconnect();
  }, []);

  useEffect(() => { dirty.current = true; });

  /* ---------- drawing */
  useEffect(() => {
    const draw = (now: number): void => {
      const c = canvasRef.current; if (!c) return;
      const ctx = c.getContext("2d"); if (!ctx) return;
      computeView();
      const K = palette();
      const v = view.current, p = P.current, fx = fxRef.current;
      const animate = motionEnabled();
      ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
      ctx.clearRect(0, 0, v.w, v.h);

      // dot grid, in screen space so it stays crisp
      ctx.fillStyle = K.grid;
      const gs = Math.max(22, 30 * Math.min(v.scale, 1));
      for (let x = v.ox % gs; x < v.w; x += gs) for (let y = v.oy % gs; y < v.h; y += gs) ctx.fillRect(x, y, 1, 1);

      ctx.save();
      if (fx.shakeMag > 0.4) ctx.translate((Math.random() * 2 - 1) * fx.shakeMag, (Math.random() * 2 - 1) * fx.shakeMag);
      ctx.translate(v.ox, v.oy); ctx.scale(v.scale, v.scale);

      const pos = new Map<string, { x: number; y: number }>();
      for (const n of p.nodes) pos.set(n.id, drag.current && drag.current.id === n.id ? { x: drag.current.x, y: drag.current.y } : pt(n));
      const byId = new Map(p.nodes.map((n) => [n.id, n]));
      const isHot = (n?: BoardNode): boolean => !!n && !n.dead && ((n.util ?? 0) > 1 || !!n.hot);

      // connections: they start and stop a little way from each icon, with an arrowhead showing which way requests flow
      const ICON_Y = -14, GAP = 34;
      for (const e of p.edges) {
        const a0 = pos.get(e.from), b0 = pos.get(e.to); if (!a0 || !b0) continue;
        const dx = b0.x - a0.x, dy = (b0.y + ICON_Y) - (a0.y + ICON_Y), len = Math.hypot(dx, dy);
        if (len < GAP * 2 + 6) continue;                                   // too close to draw a line between them
        const ux = dx / len, uy = dy / len;
        const a = { x: a0.x + ux * GAP, y: a0.y + ICON_Y + uy * GAP }, b = { x: b0.x - ux * (GAP + 4), y: b0.y + ICON_Y - uy * (GAP + 4) };
        const to = byId.get(e.to), from = byId.get(e.from);
        const bad = isHot(to), warm = !bad && (to?.util ?? 0) > 0.8, dead = to?.dead || from?.dead;
        const col = dead || bad ? K.red : warm ? K.yellow : K.edge;
        ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.lineCap = "round"; if (dead) ctx.setLineDash([6, 6]);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = col; ctx.beginPath();                              // arrowhead
        ctx.moveTo(b.x + ux * 7, b.y + uy * 7); ctx.lineTo(b.x - uy * 5, b.y + ux * 5); ctx.lineTo(b.x + uy * 5, b.y - ux * 5); ctx.closePath(); ctx.fill();
        if (animate && !dead) {
          const fl = p.flow, key = e.from + ">" + e.to;
          const failShare = fl ? (fl.failing[key] ?? 0) : 0;
          const n = fl ? Math.max(2, Math.round(2 + (fl.density[key] ?? 0.2) * 8)) : bad ? 5 : 3, speed = bad ? 0.00055 : 0.00026;
          for (let i = 0; i < n; i++) {
            const t = (now * speed + i / n) % 1;
            const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
            if (fl && i / n < failShare) {                      // a failed visitor: red, and it falls away before reaching the end
              if (t > 0.6) continue;
              ctx.globalAlpha = Math.min(1, (0.6 - t) / 0.2) * 0.95; ctx.fillStyle = K.red;
              ctx.beginPath(); ctx.arc(x, y + Math.max(0, t - 0.35) * 70, 3.4, 0, 7); ctx.fill();
              continue;
            }
            ctx.globalAlpha = Math.sin(t * Math.PI) * 0.95;
            if (i % 3 === 2) {                                   // a pink diamond is a new link being saved
              ctx.fillStyle = bad ? K.red : K.magenta;
              ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4); ctx.fillRect(-3, -3, 6, 6); ctx.restore();
            } else { ctx.fillStyle = bad ? K.red : K.cyan; ctx.beginPath(); ctx.arc(x, y, 3.2, 0, 7); ctx.fill(); }
          }
          ctx.globalAlpha = 1;
        }
      }

      // the line you are drawing while connecting two pieces
      if (p.linkFrom && pointer.current) {
        const a = pos.get(p.linkFrom);
        if (a) { ctx.strokeStyle = K.blue; ctx.lineWidth = 2; ctx.setLineDash([6, 6]); ctx.beginPath(); ctx.moveTo(a.x, a.y - 14); ctx.lineTo(pointer.current.x, pointer.current.y); ctx.stroke(); ctx.setLineDash([]); }
      }

      // how much horizontal room each piece really has on screen, so labels wrap instead of colliding
      let room = 1e9;
      for (let i = 0; i < p.nodes.length; i++) for (let j = i + 1; j < p.nodes.length; j++) {
        const a = p.nodes[i] as BoardNode, b = p.nodes[j] as BoardNode;
        const qa = pt(a), qb = pt(b);
        if (Math.abs(qa.y - qb.y) < 70) room = Math.min(room, Math.abs(qa.x - qb.x) * v.scale);
      }
      const vertical = new Set<string>();
      {
        const tally = new Map<string, number>();
        for (const e of p.edges) {
          const a = pos.get(e.from), b = pos.get(e.to); if (!a || !b) continue;
          const d = Math.abs(b.y - a.y) > Math.abs(b.x - a.x) ? 1 : -1;
          tally.set(e.from, (tally.get(e.from) ?? 0) + d); tally.set(e.to, (tally.get(e.to) ?? 0) + d);
        }
        for (const [id, t] of tally) if (t > 0) vertical.add(id);
      }
      // pieces
      const px = Math.max(1, v.scale);
      for (const n of p.nodes) {
        const at = pos.get(n.id) as { x: number; y: number };
        const info = (PART_INFO as Record<string, { fullName: string }>)[n.part];
        const label = n.part === "UNKNOWN" ? "Unknown piece" : info?.fullName ?? String(n.part);
        const hot = isHot(n), warm = !hot && (n.util ?? 0) > 0.8;
        const color = n.dead ? K.dim : hot ? K.red : resolveColor(ROLE_COLOR[n.part] ?? "var(--c-fg)");
        const selected = p.selectedId === n.id, linking = p.linkFrom === n.id, hovered = hover.current === n.id;

        if (hot && animate) {
          const pulse = 0.5 + 0.5 * Math.sin(now * 0.005);
          ctx.save(); ctx.globalAlpha = 0.07 + pulse * 0.1; ctx.fillStyle = K.red; rr(ctx, at.x - NW / 2, at.y - NH / 2, NW, NH, 10); ctx.fill(); ctx.restore();
        }
        if (selected || linking || hovered || p.highlight?.has(n.id)) {
          ctx.fillStyle = selected || linking ? K.sel : K.hl; rr(ctx, at.x - NW / 2, at.y - NH / 2, NW, NH, 9); ctx.fill();
          ctx.strokeStyle = selected || linking ? K.selBorder : K.border; ctx.lineWidth = 1; rr(ctx, at.x - NW / 2 + .5, at.y - NH / 2 + .5, NW - 1, NH - 1, 9); ctx.stroke();
        }
        const iconPx = Math.max(26, 36 * px) / v.scale;
        drawIcon(ctx, n.part === "UNKNOWN" ? "UNKNOWN" : (n.part as IconName), at.x, at.y - 14, iconPx, color, n.dead ? 0.45 : 1);
        if (n.dead) { ctx.strokeStyle = K.red; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(at.x - 12, at.y - 26); ctx.lineTo(at.x + 12, at.y - 2); ctx.moveTo(at.x + 12, at.y - 26); ctx.lineTo(at.x - 12, at.y - 2); ctx.stroke(); }

        const fs = Math.max(10.5, 12 * px) / v.scale;
        ctx.textBaseline = "alphabetic"; ctx.font = `500 ${fs}px "JetBrains Mono", monospace`;
        ctx.fillStyle = n.dead ? K.dim : selected ? K.fg : K.fg2;
        const beside = vertical.has(n.id);
        const charPx = fs * v.scale * 0.62;
        const maxChars = beside ? 16 : Math.max(7, Math.min(14, Math.floor((room - 8) / charPx)));
        const lines = wrap(label, maxChars);
        const lh = fs + 1;
        // below the icon for left-to-right flows; beside it when the connections run up and down
        const lx = beside ? at.x + iconPx / 2 + 10 : at.x;
        const top = beside ? at.y - 14 - ((lines.length - 1) * lh) / 2 + fs * 0.35 : at.y + 18;
        ctx.textAlign = beside ? "left" : "center";
        ctx.lineWidth = 4; ctx.strokeStyle = K.bg; ctx.lineJoin = "round";
        lines.forEach((ln, i) => { ctx.strokeText(ln, lx, top + i * lh); ctx.fillText(ln, lx, top + i * lh); });
        let yy = top + (lines.length - 1) * lh;
        if (n.util !== undefined && !n.dead && n.part !== "CLIENT") {
          const bw = 56, by = yy + 6, bx = beside ? lx : at.x - bw / 2;
          ctx.fillStyle = K.hl; rr(ctx, bx, by, bw, 3.5, 1.5); ctx.fill();
          ctx.fillStyle = hot ? K.red : warm ? K.yellow : K.blue; rr(ctx, bx, by, Math.max(2, bw * Math.min(1, n.util)), 3.5, 1.5); ctx.fill();
          yy = by + 4;
          if (n.util > 0.8) {
            ctx.font = `500 ${fs * 0.9}px "JetBrains Mono", monospace`; ctx.fillStyle = hot ? K.red : K.yellow;
            wrap(`${Math.round(n.util * 100)} percent full`, beside ? 20 : maxChars).forEach((ln, i) => { ctx.strokeText(ln, lx, yy + fs + i * fs * 0.95); ctx.fillText(ln, lx, yy + fs + i * fs * 0.95); });
          }
        }
        if (n.dead) { ctx.font = `500 ${fs * 0.9}px "JetBrains Mono", monospace`; ctx.fillStyle = K.red; ctx.textAlign = beside ? "left" : "center"; ctx.fillText("offline", lx, yy + fs + 4); }
        ctx.textAlign = "center";
        if (n.marked) {                                       // an attack is aimed here: a slowly rotating dashed ring
          ctx.save(); ctx.translate(at.x, at.y - 6); ctx.rotate((now / 1000) * 0.9);
          ctx.strokeStyle = K.yellow; ctx.lineWidth = 2; ctx.setLineDash([8, 7]); ctx.beginPath(); ctx.arc(0, 0, 46, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
        }
        if (fx.flashNode?.id === n.id) { ctx.fillStyle = `rgba(255,255,255,${fx.flashNode.a * 0.4})`; rr(ctx, at.x - NW / 2, at.y - NH / 2, NW, NH, 9); ctx.fill(); }
      }
      fx.draw(ctx);
      ctx.restore();
    };

    let lastDraw = 0;
    const unsub = subscribeFrame((dt, now) => {
      fxRef.current.tick(dt);
      const animate = motionEnabled();
      if (animate || dirty.current || fxRef.current.active) {
        if (now - lastDraw >= 14 || dirty.current) { draw(now); lastDraw = now; dirty.current = false; }
      }
    });
    return unsub;
  }, []);

  /* ---------- pointer interaction */
  const hit = (wx: number, wy: number): string | null => {
    const nodes = P.current.nodes, v = view.current;
    const hw = Math.max(NW / 2, 34 / v.scale), hh = Math.max(NH / 2, 34 / v.scale);
    for (let i = nodes.length - 1; i >= 0; i--) { const n = nodes[i] as BoardNode, q = pt(n); if (Math.abs(wx - q.x) <= hw && Math.abs(wy - q.y) <= hh) return n.id; }
    return null;
  };
  const world = (e: React.PointerEvent): { x: number; y: number } => {
    const r = canvasRef.current!.getBoundingClientRect(); computeView(); const v = view.current;
    return { x: (e.clientX - r.left - v.ox) / v.scale, y: (e.clientY - r.top - v.oy) / v.scale };
  };

  const down = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const w = world(e), id = hit(w.x, w.y);
    if (!id) { P.current.onTap?.(null); return; }
    const n = P.current.nodes.find((x) => x.id === id) as BoardNode;
    if (P.current.editable) {
      drag.current = { id, dx: w.x - n.x, dy: w.y - n.y, moved: false, x: n.x, y: n.y };
      (e.target as Element).setPointerCapture(e.pointerId);
    } else P.current.onTap?.(id);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const w = world(e); pointer.current = w;
    if (drag.current) {
      const q = clampW(w.x - drag.current.dx, w.y - drag.current.dy);
      if (Math.abs(q.x - drag.current.x) + Math.abs(q.y - drag.current.y) > 3) drag.current.moved = true;
      drag.current.x = q.x; drag.current.y = q.y; dirty.current = true;
    } else {
      const h = hit(w.x, w.y);
      if (h !== hover.current) { hover.current = h; dirty.current = true; (e.target as HTMLElement).style.cursor = h ? (P.current.editable ? "grab" : "pointer") : "default"; }
    }
    if (P.current.linkFrom) dirty.current = true;
  };
  const up = (): void => {
    const d = drag.current; drag.current = null;
    if (!d) return;
    if (d.moved) P.current.onMove?.(d.id, snap(d.x), snap(d.y)); else P.current.onTap?.(d.id);
    dirty.current = true;
  };

  return (
    <div className="boardwrap" ref={wrapRef}>
      <canvas ref={canvasRef} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onPointerLeave={() => { hover.current = null; pointer.current = null; dirty.current = true; }} />
      <ul className="sr-only" aria-label="The pieces on this board and how they connect">
        {props.nodes.map((n) => {
          const info = (PART_INFO as Record<string, { fullName: string }>)[n.part];
          const name = n.part === "UNKNOWN" ? "Unknown piece" : info?.fullName ?? String(n.part);
          const to = props.edges.filter((e) => e.from === n.id).map((e) => { const t = props.nodes.find((x) => x.id === e.to); const ti = t ? (PART_INFO as Record<string, { fullName: string }>)[t.part] : undefined; return t?.part === "UNKNOWN" ? "an unknown piece" : ti?.fullName ?? "a piece"; });
          return <li key={n.id} data-id={n.id} data-x={n.x} data-y={n.y}>{name}{n.util !== undefined ? `, ${Math.round(n.util * 100)} percent full` : ""}{n.dead ? ", offline" : ""}{to.length ? `. Sends requests to: ${to.join(", ")}` : "."}</li>;
        })}
      </ul>
      {props.tag ? <div className="boardtag">{props.tag}</div> : null}
      {props.hint ? <div className="boardhint">{props.hint}</div> : null}
    </div>
  );
});

function rr(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
