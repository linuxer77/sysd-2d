import { useCallback, useMemo, useState } from "react";
import { NO_CARRY, simulate, type Design, type Mods, type PartId, type Policy, type SimResult } from "@sysd/sim";
import { LINKSMASH, PARTS, RULESET, baseMods, coach } from "@sysd/shared";
import { DEFAULT_POLICY, WORLD, autoLayout, designCost, partCounts, type Layout } from "@sysd/match";
import type { BoardEdge, BoardNode } from "../board/BoardCanvas";

export interface EditorState {
  design: Design; layout: Layout; selected: string | null; linkFrom: string | null;
  /** true only when the player chose this piece by tapping it on the board, so a piece they just ADDED never silently connects */
  armed: boolean;
}

export function freshEditor(seat: 0 | 1): EditorState {
  const id = `n${seat}-1`;
  return { design: { nodes: [{ id, part: "CLIENT" }], edges: [], policy: DEFAULT_POLICY }, layout: { [id]: { x: 110, y: WORLD.h / 2 } }, selected: null, linkFrom: null, armed: false };
}

const nextId = (d: Design, seat: number): string => {
  let max = 0;
  for (const n of d.nodes) { const m = /-(\d+)$/.exec(n.id); if (m) max = Math.max(max, Number(m[1])); }
  return `n${seat}-${max + 1}`;
};

/** First free spot, scanning left to right, so a tapped "add" never stacks pieces on top of each other. */
function freeSpot(layout: Layout, near?: { x: number; y: number }): { x: number; y: number } {
  const taken = (x: number, y: number): boolean => Object.values(layout).some((p) => Math.abs(p.x - x) < 120 && Math.abs(p.y - y) < 100);
  if (near) {                                          // grow the picture left to right, next to what you just selected
    for (const dy of [0, -120, 120, -240, 240]) { const x = near.x + 200, y = near.y + dy; if (x <= WORLD.w - 60 && y >= 70 && y <= WORLD.h - 70 && !taken(x, y)) return { x, y }; }
  }
  for (let x = 300; x <= WORLD.w - 80; x += 130) for (let y = 120; y <= WORLD.h - 100; y += 120) {
    if (!Object.values(layout).some((p) => Math.abs(p.x - x) < 120 && Math.abs(p.y - y) < 100)) return { x, y };
  }
  return { x: 500, y: 320 };
}

export function useEditor(seat: 0 | 1, licences: Partial<Record<PartId, number>> | null, initial?: { design: Design; layout: Layout }) {
  const [s, setS] = useState<EditorState>(() => (initial ? { design: initial.design, layout: initial.layout, selected: null, linkFrom: null, armed: false } : freshEditor(seat)));
  const counts = useMemo(() => partCounts(s.design), [s.design]);
  const spent = useMemo(() => designCost(s.design), [s.design]);

  const left = useCallback((p: PartId): number => (licences === null ? 99 : (licences[p] ?? 0)) - (counts[p] ?? 0), [licences, counts]);

  const add = useCallback((part: PartId, at?: { x: number; y: number }): boolean => {
    let ok = false;
    setS((cur) => {
      const c = partCounts(cur.design);
      const have = licences === null ? 99 : (licences[part] ?? 0);
      if ((c[part] ?? 0) >= have || cur.design.nodes.length >= 16) return cur;
      const id = nextId(cur.design, seat);
      const sel = cur.selected ? cur.layout[cur.selected] : undefined;
      const pos = at ?? freeSpot(cur.layout, sel);
      ok = true;
      return { ...cur, design: { ...cur.design, nodes: [...cur.design.nodes, { id, part }] }, layout: { ...cur.layout, [id]: { x: Math.round(pos.x / 4) * 4, y: Math.round(pos.y / 4) * 4 } }, selected: id, armed: false };
    });
    return ok;
  }, [licences, seat]);

  const move = useCallback((id: string, x: number, y: number) => setS((c) => ({ ...c, layout: { ...c.layout, [id]: { x, y } } })), []);
  const select = useCallback((id: string | null) => setS((c) => ({ ...c, selected: id, armed: false, linkFrom: c.linkFrom && id && c.linkFrom !== id ? null : c.linkFrom })), []);

  /**
   * Tapping a piece: select it. With a piece already selected, tapping a different one connects the first to the
   * second (tap the same pair again to disconnect). Tap empty space to deselect. The "Connect" button does the
   * same thing explicitly, which is easier on a touch screen.
   */
  const tap = useCallback((id: string | null) => setS((c) => {
    const from = c.linkFrom ?? (c.armed ? c.selected : null);
    if (id && from && from !== id) {
      const exists = c.design.edges.some((e) => e.from === from && e.to === id);
      const edges = exists ? c.design.edges.filter((e) => !(e.from === from && e.to === id)) : [...c.design.edges, { from, to: id }];
      return { ...c, design: { ...c.design, edges }, linkFrom: null, selected: id, armed: false };
    }
    if (id && c.linkFrom === id) return { ...c, linkFrom: null };
    return { ...c, selected: id, linkFrom: null, armed: id !== null };
  }), []);

  const startLink = useCallback((id: string) => setS((c) => ({ ...c, linkFrom: c.linkFrom === id ? null : id, selected: id, armed: false })), []);
  const remove = useCallback((id: string) => setS((c) => {
    const n = c.design.nodes.find((x) => x.id === id);
    if (!n || n.part === "CLIENT") return c;
    const { [id]: _gone, ...layout } = c.layout;
    return { ...c, design: { ...c.design, nodes: c.design.nodes.filter((x) => x.id !== id), edges: c.design.edges.filter((e) => e.from !== id && e.to !== id) }, layout, selected: null, linkFrom: null, armed: false };
  }), []);
  const unlink = useCallback((from: string, to: string) => setS((c) => ({ ...c, design: { ...c.design, edges: c.design.edges.filter((e) => !(e.from === from && e.to === to)) } })), []);
  const policy = useCallback((p: Partial<Policy>) => setS((c) => ({ ...c, design: { ...c.design, policy: { ...c.design.policy, ...p } } })), []);
  const tidy = useCallback(() => setS((c) => ({ ...c, layout: autoLayout(c.design) })), []);
  const load = useCallback((design: Design, layout: Layout) => setS({ design, layout, selected: null, linkFrom: null, armed: false }), []);

  return { ...s, counts, spent, left, add, move, select, tap, startLink, remove, unlink, policy, tidy, load };
}
export type Editor = ReturnType<typeof useEditor>;

/** The real simulator, run on your own design, so the "how full" bars are true rather than decorative. */
export function useAnalysis(design: Design, mods?: Mods): { result: SimResult | null; utilOf: Record<string, number> } {
  return useMemo(() => {
    try {
      const r = simulate({ design, ruleset: RULESET, scenario: LINKSMASH, mods: mods ?? baseMods(LINKSMASH.roundSeconds), carry: NO_CARRY }).result;
      if (!r.nodes.length) return { result: null, utilOf: {} };
      const utilOf: Record<string, number> = {};
      for (const n of r.nodes) utilOf[n.id] = n.util;
      return { result: r, utilOf };
    } catch { return { result: null, utilOf: {} }; }
  }, [design, mods]);
}

export function useCoach(design: Design) {
  return useMemo(() => { try { return coach(design, RULESET, LINKSMASH); } catch { return []; } }, [design]);
}

export function toBoard(design: Design, layout: Layout, utilOf: Record<string, number> = {}, killed: readonly string[] = []): { nodes: BoardNode[]; edges: BoardEdge[] } {
  return {
    nodes: design.nodes.map((n) => { const p = layout[n.id] ?? { x: 500, y: 320 }; const u = utilOf[n.id]; return { id: n.id, part: n.part, x: p.x, y: p.y, ...(u !== undefined ? { util: u } : {}), dead: killed.includes(n.id) }; }),
    edges: design.edges.map((e) => ({ from: e.from, to: e.to })),
  };
}
export { PARTS };
