import { useEffect, useRef, useState, type ReactNode } from "react";
import { GLOSSARY } from "@sysd/shared";
import { Icon } from "../icons/Icon";

/** mm:ss from a deadline. Goes amber then red as time runs out. */
export function Timer({ deadlineAt, now, label }: { deadlineAt: number | null; now: number; label?: string }) {
  if (deadlineAt === null) return null;
  const left = Math.max(0, deadlineAt - now), s = Math.ceil(left / 1000);
  const text = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const cls = s <= 5 ? "hot" : s <= 15 ? "warm" : "";
  return <span className={`pill ${s <= 5 ? "bad" : s <= 15 ? "warn" : ""}`} aria-label={`${label ?? "Time left"}: ${s} seconds`}><Icon name="TIMER" size={13} /><span className={`timer ${cls}`}>{text}</span></span>;
}

/** Health with a ghost bar that trails behind the real value: the fill drops at once, the ghost follows after a beat. */
export function HealthBar({ who, hp, flip }: { who: string; hp: number; flip?: boolean }) {
  const prev = useRef(hp); const [pop, setPop] = useState(0);
  useEffect(() => { if (hp < prev.current) setPop((n) => n + 1); prev.current = hp; }, [hp]);
  const pct = Math.max(0, Math.min(100, hp));
  const col = pct > 50 ? "var(--good)" : pct > 22 ? "var(--warn)" : "var(--bad)";
  return (
    <div className={`hp ${pct <= 22 ? "low" : ""}`} aria-label={`${who} health ${Math.round(pct)} out of 100`} style={flip ? { flexDirection: "row-reverse" } : undefined}>
      <span className="who">{who}</span>
      <span className="track"><span className="ghostfill" style={{ width: `${pct}%` }} /><span className="fill" style={{ width: `${pct}%`, background: col }} /></span>
      <span className={`n ${pop ? "pop" : ""}`} key={pop}>{Math.round(pct)}<span className="muted"> of 100</span></span>
    </div>
  );
}

/** A technical word with its plain-language meaning one hover or tap away. */
export function Term({ children, term }: { children: ReactNode; term?: string }) {
  const key = term ?? (typeof children === "string" ? children : "");
  const e = GLOSSARY.find((g) => g.term.toLowerCase() === key.toLowerCase());
  const [open, setOpen] = useState(false);
  if (!e) return <>{children}</>;
  return (
    <span className="glossary" tabIndex={0} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onClick={() => setOpen((o) => !o)}>
      {children}
      {open ? <span role="tooltip" style={{ position: "absolute", left: 0, top: "1.6em", zIndex: 60, width: 260, padding: "8px 10px", background: "var(--bg-selected)", border: "1px solid var(--c-sel-border)", borderRadius: 6, color: "var(--text)", fontSize: 12, lineHeight: 1.45, boxShadow: "0 8px 22px rgba(0,0,0,.5)", textAlign: "left" }}><b>{e.term}.</b> {e.meaning}</span> : null}
    </span>
  );
}

export function Plural({ n, one, many }: { n: number; one: string; many: string }) { return <>{n} {n === 1 ? one : many}</>; }

/** Detail on demand: closed by default, so the first thing a beginner sees is short. */
export function More({ label, children, open }: { label: string; children: ReactNode; open?: boolean }) {
  return <details className="more" open={open}><summary>{label}</summary><div className="more-body">{children}</div></details>;
}

/** The run's health: how many more visitors you can afford to fail. The fill drops at once and a ghost trails behind. */
export function AllowanceBar({ left, max }: { left: number; max: number }) {
  const prev = useRef(left); const [pop, setPop] = useState(0);
  useEffect(() => { if (left < prev.current - 1) setPop((n) => n + 1); prev.current = left; }, [left]);
  const pct = Math.max(0, Math.min(100, (left / max) * 100));
  const col = pct > 50 ? "var(--good)" : pct > 22 ? "var(--warn)" : "var(--bad)";
  return (
    <div className={`hp ${pct <= 22 ? "low" : ""}`} aria-label={`You can still afford to fail ${Math.round(left)} visitors, out of ${max}`}>
      <span className="who" style={{ minWidth: 0 }}>Failed visitors you can still afford</span>
      <span className="track"><span className="ghostfill" style={{ width: `${pct}%` }} /><span className="fill" style={{ width: `${pct}%`, background: col }} /></span>
      <span className={`n ${pop ? "pop" : ""}`} key={pop}>{Math.round(left).toLocaleString("en-US")}</span>
    </div>
  );
}
