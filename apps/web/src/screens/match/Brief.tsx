import { useState } from "react";
import { Icon } from "../../icons/Icon";
import type { IconName } from "../../icons/paths";
import { Guide, send, type MatchProps } from "./common";

const FACTS: { icon: IconName; color: string; big: string; small: string }[] = [
  { icon: "CLIENT", color: "var(--c-blue)", big: "100 million visits a day", small: "Almost all of them just open a short link." },
  { icon: "ATK_SPIKE", color: "var(--c-cyan)", big: "5 times busier at the peak", small: "You have to survive the busiest moment, not the average one." },
  { icon: "TIMER", color: "var(--c-yellow)", big: "Under 100 milliseconds", small: "Every visit must feel instant." },
  { icon: "HEART", color: "var(--c-red)", big: "Never go down", small: "Things will break. Your service must keep working." },
  { icon: "LOCK", color: "var(--c-green)", big: "A budget of $700", small: "You cannot afford everything. Choose well." },
];

const PLAN: { icon: IconName; title: string; line: string }[] = [
  { icon: "USERS", title: "1. Draft", line: "You and your rival take turns picking pieces." },
  { icon: "APP", title: "2. Build", line: "Connect your pieces into a working service." },
  { icon: "SCAN", title: "3. Scout", line: "Peek at what your rival built." },
  { icon: "ATK_KILL", title: "4. Fight", line: "Six rounds of attacks. Most health left wins." },
];

/** The problem comes BEFORE any choice, with time to read it. */
export function Brief({ session, v, now }: MatchProps) {
  const [sent, setSent] = useState(false);
  const done = v.self.briefDone || sent;
  const secs = v.deadlineAt ? Math.max(0, Math.ceil((v.deadlineAt - now) / 1000)) : 0;
  return (
    <>
      <Guide title="Read the problem first.">You are about to pick pieces. Know what you are building. The draft starts when you are both ready{secs ? `, or in ${secs} seconds` : ""}.</Guide>
      <div className="scrollscreen"><div className="center" style={{ maxWidth: 860 }}>
        <div className="stack" style={{ gap: 6 }}>
          <div className="eyebrow">The problem</div>
          <h2>You run a website that shortens links.</h2>
          <p className="lede" style={{ fontSize: 15 }}>Someone pastes a long web address and gets a short one. Anyone who opens the short link is sent to the real page. It has just become very popular.</p>
        </div>
        <div className="grid cols3">
          {FACTS.map((f) => (
            <div key={f.big} className="card stack" style={{ gap: 6 }}>
              <Icon name={f.icon} size={28} color={f.color} />
              <b style={{ fontSize: 15 }}>{f.big}</b>
              <span className="muted" style={{ fontSize: 12.5 }}>{f.small}</span>
            </div>
          ))}
        </div>
        <div className="stack" style={{ gap: 8 }}>
          <div className="eyebrow">What happens next</div>
          <div className="grid" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
            {PLAN.map((p) => (
              <div key={p.title} className="card stack" style={{ gap: 4 }}>
                <Icon name={p.icon} size={22} color="var(--accent)" />
                <b>{p.title}</b><span className="muted" style={{ fontSize: 12.5 }}>{p.line}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="cluster" style={{ position: "sticky", bottom: -20, background: "var(--bg)", padding: "12px 0", borderTop: "1px solid var(--line)", margin: "0 -4px" }}>
          <button className="btn go big" disabled={done} onClick={() => { setSent(true); void send(session, { k: "brief.done" }); }}>{done ? "Waiting for your rival…" : "I understand. Start the draft"}</button>
        </div>
      </div></div>
    </>
  );
}
