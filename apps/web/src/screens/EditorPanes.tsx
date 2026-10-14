import { useRef, useState, type ReactNode } from "react";
import { PART_INFO, LINKSMASH, PARTS, type CoachTip } from "@sysd/shared";
import type { PartId } from "@sysd/sim";
import { Icon } from "../icons/Icon";
import { ROLE_COLOR, type IconName } from "../icons/paths";
import type { BoardHandle } from "../board/BoardCanvas";
import { PaneHead, } from "../shell/Frame";
import { More, Term } from "../shell/widgets";
import type { Editor } from "./editor";

/** The first sentence, cut at a word boundary, never mid-word. */
export function brief(text: string, max = 62): string {
  const first = text.split(/(?<=[.:])\s/)[0] ?? text;
  if (first.length <= max) return first.replace(/[.:]$/, "");
  const cut = first.slice(0, max); const sp = cut.lastIndexOf(" ");
  return (sp > 20 ? cut.slice(0, sp) : cut).replace(/[,;:\s]+$/, "") + "…";
}

export const ORDER: PartId[] = ["APP", "LB", "CACHE", "CDN", "DB", "REPLICA", "QUEUE", "WORKER", "RATELIMIT"];

/** Drag a piece out of the list onto the board, or just tap it to drop it on the next free spot. */
export function Palette({ editor, licences, board, budget = LINKSMASH.budget, prices, meta, canAfford, lockedNote }: {
  editor: Editor; licences: Partial<Record<PartId, number>> | null; board: React.RefObject<BoardHandle | null>; budget?: number;
  /** the run mode charges its own prices and its own idea of what you can afford */
  prices?: Partial<Record<PartId, number>>; meta?: string; canAfford?: (p: PartId) => boolean; lockedNote?: string;
}) {
  const [ghost, setGhost] = useState<{ part: PartId; x: number; y: number } | null>(null);
  const [info, setInfo] = useState<PartId | null>(null);
  const start = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const down = (e: React.PointerEvent, part: PartId): void => {
    if (editor.left(part) <= 0) { setInfo(part); return; }
    e.preventDefault();
    start.current = { x: e.clientX, y: e.clientY, moved: false };
    const onMove = (m: PointerEvent): void => {
      if (start.current && Math.hypot(m.clientX - start.current.x, m.clientY - start.current.y) > 6) start.current.moved = true;
      setGhost({ part, x: m.clientX, y: m.clientY });
    };
    const onUp = (u: PointerEvent): void => {
      window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp);
      const moved = start.current?.moved; start.current = null; setGhost(null);
      if (moved) { const w = board.current?.toWorld(u.clientX, u.clientY); if (w) editor.add(part, w); }
      else { editor.add(part); setInfo(part); }
    };
    window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", onUp);
  };

  const owned = (p: PartId): number => (licences === null ? 99 : (licences[p] ?? 0));
  const spent = editor.spent;
  return (
    <>
      <PaneHead title="Pieces" meta={meta ?? `$${spent} of $${budget}`} />
      <div className="pane-b">
        {ORDER.map((p) => {
          const left = editor.left(p), has = owned(p) > 0, cost = prices?.[p] ?? PARTS[p].cost, afford = canAfford ? canAfford(p) : spent + cost <= budget;
          const off = !has || left <= 0;
          return (
            <button key={p} className={`row draggable ${off ? "off" : ""} ${info === p ? "sel" : ""}`} onPointerDown={(e) => down(e, p)}
              aria-label={`${PART_INFO[p].fullName}, costs ${cost} dollars`} aria-disabled={off}>
              <span className="ic"><Icon name={p as IconName} size={22} color={off ? "var(--c-dim)" : ROLE_COLOR[p]} /></span>
              <span className="nm">{PART_INFO[p].fullName}{licences !== null && (!has || left <= 0 || owned(p) < 50) ? <small>{!has ? (lockedNote ?? "Win it in the draft") : left <= 0 ? "None left" : `${left} left`}</small> : null}</span>
              <span className="meta" style={{ color: !afford && !off ? "var(--bad)" : undefined }}>${cost}</span>
            </button>
          );
        })}
        {info ? <PartCard part={info} /> : <div className="muted" style={{ fontSize: 12, padding: "10px 6px" }}>Drag a piece onto the board, or tap it.</div>}
      </div>
      {ghost ? <div className="ghost" style={{ left: ghost.x, top: ghost.y }}><Icon name={ghost.part as IconName} size={16} color={ROLE_COLOR[ghost.part]} />{PART_INFO[ghost.part].fullName}</div> : null}
    </>
  );
}

export function PartCard({ part }: { part: PartId | "UNKNOWN" }) {
  if (part === "UNKNOWN") return <div className="card" style={{ marginTop: 10, fontSize: 12.5 }}><b>Unknown piece</b><div className="muted">Spend a scouting point to find out what it is.</div></div>;
  const i = PART_INFO[part];
  return (
    <div className="card" style={{ marginTop: 10, fontSize: 12.5 }}>
      <div className="cluster" style={{ marginBottom: 4 }}><Icon name={part as IconName} size={22} color={ROLE_COLOR[part]} /><b style={{ fontSize: 14 }}>{i.fullName}</b></div>
      <div>{brief(i.summary, 90)}</div>
      <More label="More about it">
        <p><b>Think of it as:</b> {i.analogy}</p>
        <p><b style={{ color: "var(--good)" }}>Use it when:</b> {i.useWhen}</p>
        <p><b style={{ color: "var(--warn)" }}>Watch out:</b> {i.watchOut}</p>
      </More>
    </div>
  );
}

const DOT: Record<string, string> = { problem: "var(--bad)", warning: "var(--warn)", idea: "var(--c-cyan)", good: "var(--good)" };

/** Problems as one-line rows. Click one to read why and what to try. */
export function CoachTips({ tips, max = 4 }: { tips: readonly CoachTip[]; max?: number }) {
  const [open, setOpen] = useState<string | null>("");
  const top = tips.slice(0, max);
  const current = open && top.some((t) => t.id === open) ? open : null;
  return (
    <>
      {top.map((t) => (
        <div key={t.id} className={`issue ${t.kind} ${current === t.id ? "open" : ""}`}>
          <button onClick={() => setOpen(current === t.id ? "" : t.id)} aria-expanded={current === t.id}>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: DOT[t.kind], flex: "0 0 auto" }} />{t.title}<span className="chev">›</span>
          </button>
          {current === t.id ? <div className="body"><p>{t.body}</p>{t.tryThis ? <p className="try"><b>Try this:</b> {t.tryThis}</p> : null}</div> : null}
        </div>
      ))}
      {tips.length > max ? <div className="muted" style={{ fontSize: 12 }}>{tips.length - max} more. Fix these first.</div> : null}
    </>
  );
}

/** The right-hand side while building: your advice first, everything else tucked away. */
export function Inspector({ editor, tips, footer, budget = LINKSMASH.budget, children }: { editor: Editor; tips: readonly CoachTip[]; footer?: ReactNode; budget?: number; children?: ReactNode }) {
  const sel = editor.design.nodes.find((n) => n.id === editor.selected);
  const p = editor.design.policy;
  const over = editor.spent > budget;
  return (
    <>
      <PaneHead title="Coach" meta={`${editor.design.nodes.length} pieces`} />
      <div className="pane-b" style={{ padding: 0 }}>
        {children}
        <div className="grp">
          <h4>What to fix</h4>
          <CoachTips tips={tips} />
        </div>
        {sel ? (
          <div className="grp">
            <h4>Selected</h4>
            <PartCard part={sel.part} />
            <div className="cluster" style={{ marginTop: 8 }}>
              <button className={`btn small ${editor.linkFrom === sel.id ? "go" : ""}`} onClick={() => editor.startLink(sel.id)}><Icon name="LINK" size={14} />{editor.linkFrom === sel.id ? "Tap where it goes" : "Connect"}</button>
              {sel.part !== "CLIENT" ? <button className="btn small danger" onClick={() => editor.remove(sel.id)}><Icon name="CROSS" size={14} />Remove</button> : null}
            </div>
            {(() => {
              const outs = editor.design.edges.filter((e) => e.from === sel.id);
              return outs.length ? <div style={{ fontSize: 12, marginTop: 6 }}>{outs.map((e) => {
                const t = editor.design.nodes.find((n) => n.id === e.to);
                return <div key={e.to} className="cluster" style={{ justifyContent: "space-between" }}><span>Sends to {t ? PART_INFO[t.part].fullName.toLowerCase() : "?"}</span><button className="btn small" onClick={() => editor.unlink(e.from, e.to)}>Disconnect</button></div>;
              })}</div> : null;
            })()}
          </div>
        ) : null}
        <div className="grp">
          <div className="kv"><span className="k">Budget</span><span className="v" style={{ color: over ? "var(--bad)" : undefined }}>${editor.spent} of ${budget}</span></div>
          <div className={`bar ${over ? "over" : ""}`}><i style={{ width: `${Math.min(100, (editor.spent / budget) * 100)}%` }} /></div>
          {over ? <div style={{ color: "var(--bad)", fontSize: 12, marginTop: 6 }}>Over budget by ${editor.spent - budget}. Remove something.</div> : null}
          <More label="Advanced settings">
            <div className="kv"><span className="k"><Term term="Timeout">Visitors wait</Term></span>
              <span className="stepper"><button aria-label="Wait less" onClick={() => editor.policy({ readTimeoutMs: Math.max(50, p.readTimeoutMs - 50) })}>−</button><span className="n">{p.readTimeoutMs} milliseconds</span><button aria-label="Wait longer" onClick={() => editor.policy({ readTimeoutMs: Math.min(1000, p.readTimeoutMs + 50) })}>+</button></span></div>
            <div className="kv"><span className="k"><Term term="Retry">Retries</Term></span>
              <span className="stepper"><button aria-label="Fewer retries" onClick={() => editor.policy({ retries: Math.max(0, p.retries - 1) })}>−</button><span className="n">{p.retries} {p.retries === 1 ? "time" : "times"}</span><button aria-label="More retries" onClick={() => editor.policy({ retries: Math.min(4, p.retries + 1) })}>+</button></span></div>
            <div className="kv"><span className="k"><Term term="Circuit breaker">Safety switch</Term></span>
              <button className="sw" role="switch" aria-checked={p.breaker} aria-label="Circuit breaker" onClick={() => editor.policy({ breaker: !p.breaker })} /></div>
            <p className="muted" style={{ fontSize: 11.5 }}>The safety switch stops retries when too many requests fail, so an overload cannot snowball.</p>
          </More>
          <div className="stack" style={{ marginTop: 10 }}>
            <button className="btn small" onClick={editor.tidy}><Icon name="TIDY" size={14} />Tidy the board</button>
            {footer}
          </div>
        </div>
      </div>
    </>
  );
}
