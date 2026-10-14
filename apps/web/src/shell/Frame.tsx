import { useState, type ReactNode } from "react";
import { getMotion, setMotion, type MotionPref } from "../anim/motion";
import { Icon } from "../icons/Icon";
import { useApp } from "../state/store";
import { GithubLink } from "./Github";

export interface Crumb { label: string; onClick?: () => void }

/** The terminal window: breadcrumb title bar, content, status bar. Persistent across every screen. */
export function Frame({ crumbs, pills, status, children }: { crumbs: Crumb[]; pills?: ReactNode; status?: ReactNode; children: ReactNode }) {
  const [motion, setM] = useState<MotionPref>(getMotion());
  const notice = useApp((s) => s.notice), say = useApp((s) => s.say);
  const next = (): void => { const n: MotionPref = motion === "auto" ? "reduced" : motion === "reduced" ? "full" : "auto"; setMotion(n); setM(n); };
  const label = motion === "auto" ? "Motion: automatic" : motion === "full" ? "Motion: full" : "Motion: reduced";
  return (
    <div className="app">
      <div className="term">
        <div className="titlebar">
          <span className="logo"><Icon name="CDN" size={20} /></span>
          <nav className="crumb" aria-label="Where you are">
            {crumbs.map((c, i) => (
              <span key={i} style={{ display: "contents" }}>
                {i > 0 ? <span className="sep">/</span> : null}
                {c.onClick ? <button className="dir" onClick={c.onClick}>{c.label}</button> : <span className={i === crumbs.length - 1 ? "cur" : "dir"}>{c.label}</span>}
              </span>
            ))}
          </nav>
          <div className="tb-right">
            {pills}
            <button className="pill" onClick={next} title="Turn animations on or off. Automatic follows your device setting." aria-label={label}>{label}</button>
            <GithubLink label={false} />
          </div>
        </div>
        {notice ? (
          <div className="banner warn" role="status" onClick={() => say(null)} style={{ cursor: "pointer" }}>
            <Icon name="TELEGRAPH" size={16} /> {notice} <span className="muted" style={{ marginLeft: "auto" }}>Click to dismiss</span>
          </div>
        ) : null}
        {children}
        {status ? <div className="statusbar">{status}</div> : null}
      </div>
    </div>
  );
}

/** Three panes on a wide screen. On a phone they become tabs, one pane at a time. */
export function Panes({ left, centre, right, leftTitle = "Pieces", rightTitle = "Coach", start = "centre" }: {
  left?: ReactNode; centre: ReactNode; right?: ReactNode; leftTitle?: string; rightTitle?: string; start?: "left" | "centre" | "right";
}) {
  const [tab, setTab] = useState<"left" | "centre" | "right">(start);
  const cls = left && right ? "panes" : left || right ? "panes two" : "panes one";
  return (
    <>
      <div className={cls}>
        {left ? <aside className={`pane ${tab === "left" ? "show" : ""}`}>{left}</aside> : null}
        <main className={`pane ${tab === "centre" ? "show" : ""}`}>{centre}</main>
        {right ? <aside className={`pane ${tab === "right" ? "show" : ""}`}>{right}</aside> : null}
      </div>
      {left || right ? (
        <div className="tabs" role="tablist">
          {left ? <button role="tab" aria-selected={tab === "left"} className={tab === "left" ? "on" : ""} onClick={() => setTab("left")}>{leftTitle}</button> : null}
          <button role="tab" aria-selected={tab === "centre"} className={tab === "centre" ? "on" : ""} onClick={() => setTab("centre")}>Board</button>
          {right ? <button role="tab" aria-selected={tab === "right"} className={tab === "right" ? "on" : ""} onClick={() => setTab("right")}>{rightTitle}</button> : null}
        </div>
      ) : null}
    </>
  );
}

export function PaneHead({ title, meta }: { title: string; meta?: ReactNode }) {
  return <div className="pane-h"><b>{title}</b>{meta ? <span>{meta}</span> : null}</div>;
}
