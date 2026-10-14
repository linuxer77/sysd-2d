import { useState } from "react";
import { KIND_INFO, UPGRADES } from "@sysd/run";
import { ATTACKS, ATTACK_INFO, GLOSSARY, LINKSMASH_BRIEF, OPERATION_INFO, PART_INFO } from "@sysd/shared";
import { PageHeader, SiteShell } from "../shell/Site";
import { Icon } from "../icons/Icon";
import { ROLE_COLOR, type IconName } from "../icons/paths";
import { useApp } from "../state/store";
import { ORDER, PartCard } from "./EditorPanes";

type Tab = "start" | "waves" | "pieces" | "attacks" | "words";
const TABS: [Tab, string][] = [["start", "The big picture"], ["waves", "Waves and rewards"], ["pieces", "The pieces"], ["attacks", "Attacks and defences"], ["words", "Words explained"]];

export function Learn() {
  const go = useApp((s) => s.go);
  const [tab, setTab] = useState<Tab>("start");
  return (
    <SiteShell active="learn">
      <div className="page narrow">
        <PageHeader eyebrow="How it works" title="Everything, explained plainly" lede="The pieces, the attacks, and every technical word. None of this is a test. Take your time." />
        <div className="chips">
          {TABS.map(([k, l]) => <button key={k} className={`chip-btn ${tab === k ? "on" : ""}`} style={tab === k ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined} onClick={() => setTab(k)}>{l}</button>)}
        </div>
        {tab === "start" ? <>
          <h2>The big picture</h2>
          <p className="lede">{LINKSMASH_BRIEF.story}</p>
          <div className="card"><h3>Your goal</h3><p style={{ margin: "6px 0 0" }}>{LINKSMASH_BRIEF.yourGoal}</p></div>
          <h3>How a match works</h3>
          <div className="grid cols2">
            {[
              ["1. Draft", "You and your rival take turns choosing between two bundles of pieces. Whatever you do not choose goes to your rival, so every choice is also a gift."],
              ["2. Build", "You have five minutes and a budget to place pieces and connect them. Finish early with a design that works and you earn extra scouting points."],
              ["3. Scout", "You get a look at the shape of your rival's design, but not what each piece is. Spend scouting points to reveal the ones that matter."],
              ["4. Siege", "Six rounds. Each round you both secretly choose an attack. You warn each other about what kind of trouble is coming, then each choose a defence. Then everything happens at once."],
              ["5. Review", "Whoever has more health left wins. You see both designs and exactly why things broke, so every match teaches you something."],
            ].map(([t, b]) => <div className="card" key={t}><b>{t}</b><p className="muted" style={{ margin: "6px 0 0" }}>{b}</p></div>)}
          </div>
          <h3>What you are being scored on</h3>
          {LINKSMASH_BRIEF.requirements.map((r) => (
            <div className="card" key={r.need}><b>{r.need}</b><p style={{ margin: "6px 0" }}>{r.meaning}</p><p className="muted" style={{ margin: 0 }}><b>How it is scored:</b> {r.howItIsScored}</p></div>
          ))}
          <div className="card"><b>What this game does not test</b><p className="muted" style={{ margin: "6px 0 0" }}>{LINKSMASH_BRIEF.notScoredHere}</p></div>
          <p className="muted">On the board, <span style={{ color: "var(--c-cyan)" }}>blue dots</span> are visitors opening links, and <span style={{ color: "var(--c-magenta)" }}>pink diamonds</span> are new links being saved. Dots turn red when a piece is too full.</p>
        </> : null}
        {tab === "waves" ? <>
          <h2>The kinds of wave</h2>
          <p className="lede">Every wave is a different problem, and every problem has a piece that answers it. The wave card tells you what is coming before you start.</p>
          <div className="cards c2">{Object.values(KIND_INFO).map((k) => <div key={k.title} className="tile"><h3>{k.title}</h3><p>{k.what}</p><p><b>What helps:</b> {k.answer}</p></div>)}</div>
          <h2>The rewards</h2>
          <p className="lede">After each wave you pick one of three rewards. Some unlock new pieces, some make what you have stronger for the rest of the run, and some give you money.</p>
          <div className="cards c2">{UPGRADES.map((u) => <div key={u.id} className="tile"><h3>{u.name}</h3><p>{u.text}</p></div>)}</div>
        </> : null}
        {tab === "pieces" ? <>
          <h2>The pieces</h2>
          <div className="grid cols2">
            {["CLIENT", ...ORDER].map((p) => <div key={p}><PartCard part={p as never} /></div>)}
          </div>
        </> : null}
        {tab === "attacks" ? <>
          <h2>Attacks and defences</h2>
          <p className="lede">Every round, you can attack your rival and defend yourself. Nothing here is random: the game simply measures what really happens to each design.</p>
          <div className="grid cols2">
            {Object.values(ATTACKS).map((a) => { const i = ATTACK_INFO[a.id]; const ic = ("ATK_" + (a.id === "WRITE_STORM" ? "STORM" : a.id)) as IconName;
              return <div className="card" key={a.id}><div className="cluster"><Icon name={ic} size={22} color={ROLE_COLOR[ic]} /><b>{i.fullName}</b></div>
                <p style={{ margin: "8px 0 4px" }}>{i.whatHappens}</p><p className="muted" style={{ margin: "0 0 4px" }}><b>In real life:</b> {i.realWorld}</p><p style={{ margin: 0 }}><b style={{ color: "var(--good)" }}>How to defend:</b> {i.howToDefend}</p></div>; })}
          </div>
          <h3>Defences</h3>
          <div className="grid cols3">
            {(Object.keys(OPERATION_INFO) as (keyof typeof OPERATION_INFO)[]).map((k) => { const o = OPERATION_INFO[k]; const ic = ("OPS_" + k) as IconName;
              return <div className="card" key={k}><div className="cluster"><Icon name={ic} size={20} color={ROLE_COLOR[ic]} /><b>{o.fullName}</b></div><p style={{ margin: "8px 0 4px" }}>{o.whatHappens}</p><p className="muted" style={{ margin: 0 }}><b>Use it:</b> {o.whenToUse}</p></div>; })}
          </div>
        </> : null}
        {tab === "words" ? <>
          <h2>Words explained</h2>
          <div className="stack">{GLOSSARY.map((g) => <div className="card" key={g.term}><b>{g.term}</b><p style={{ margin: "4px 0 0", color: "var(--text-2)" }}>{g.meaning}</p></div>)}</div>
        </> : null}
        <div><button className="btn go big" onClick={() => go("guided")}>Try the guided first game</button></div>
        <span style={{ display: "none" }}>{Object.keys(PART_INFO).length}</span>
      </div>
    </SiteShell>
  );
}
