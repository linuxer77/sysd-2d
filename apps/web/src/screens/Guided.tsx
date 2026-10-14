import { useEffect, useMemo, useRef, useState } from "react";
import { ATTACKS, ATTACK_INFO, LINKSMASH, LINKSMASH_BRIEF, LINKSMASH_MISSIONS, PART_INFO, RULESET, applyAttack, baseMods, evaluateMissions, type AttackId } from "@sysd/shared";
import { simulate, damage, NO_CARRY } from "@sysd/sim";
import { Frame, Panes, PaneHead } from "../shell/Frame";
import { More } from "../shell/widgets";
import { BoardCanvas, type BoardHandle } from "../board/BoardCanvas";
import { Icon } from "../icons/Icon";
import { ROLE_COLOR, type IconName } from "../icons/paths";
import { useApp } from "../state/store";
import { Fx } from "../anim/fx";
import { toBoard, useAnalysis, useCoach, useEditor } from "./editor";
import { Inspector, Palette } from "./EditorPanes";
import { createLocalMatch } from "./newMatch";

const ctx = { ruleset: RULESET, scenario: LINKSMASH };
const atkIcon = (id: AttackId): IconName => ("ATK_" + (id === "WRITE_STORM" ? "STORM" : id)) as IconName;

export function Guided() {
  const go = useApp((s) => s.go);
  const editor = useEditor(0, null);
  const board = useRef<BoardHandle | null>(null);
  const fx = useRef(new Fx());
  const [intro, setIntro] = useState(true);
  const [test, setTest] = useState<{ id: AttackId; target?: string } | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());

  const mods = useMemo(() => (test ? applyAttack(baseMods(LINKSMASH.roundSeconds), test.id, test.target) : undefined), [test]);
  const analysis = useAnalysis(editor.design, mods);
  const tips = useCoach(editor.design);
  const progress = useMemo(() => evaluateMissions(editor.design, ctx), [editor.design]);
  const step = LINKSMASH_MISSIONS[progress.currentIndex]!;
  const stepState = progress.steps[progress.currentIndex]!;

  // a small celebration the first time each step is completed
  useEffect(() => {
    progress.steps.forEach((s, i) => {
      if (s.done && !done.has(s.id)) {
        setDone((d) => new Set(d).add(s.id));
        const c = board.current; if (c) { c.fx.ring(500, 320, "var(--c-green)", 360, 4); c.fx.burst(500, 320, 40, "var(--c-green)", 4); }
        void i;
      }
    });
  }, [progress, done]);

  const killed = test?.id === "KILL" && test.target ? [test.target] : [];
  const { nodes, edges } = toBoard(editor.design, editor.layout, analysis.utilOf, killed);

  const outcome = useMemo(() => {
    if (!test || !analysis.result) return null;
    const m = applyAttack(baseMods(LINKSMASH.roundSeconds), test.id, test.target);
    const r = simulate({ design: editor.design, ruleset: RULESET, scenario: LINKSMASH, mods: m, carry: NO_CARRY }).result;
    const dmg = Math.min(45, Math.round(damage(r, LINKSMASH, RULESET, m.durationSec).total));
    const top = [...r.nodes].filter((n) => n.part !== "CLIENT" && !n.dead).sort((a, b) => b.util - a.util)[0];
    return { dmg, top, amp: r.read.amplification, p99: r.read.p99Ms, fail: r.read.userFail };
  }, [test, editor.design, analysis.result]);

  const runTest = (id: AttackId): void => {
    const db = editor.design.nodes.find((n) => n.part === "DB");
    const target = id === "KILL" ? (test?.target ?? db?.id) : undefined;
    setTest(target ? { id, target } : { id });
    board.current?.fx.shake(5);
  };

  const missionPanel = (
    <>
      <div className="grp" style={{ background: "var(--bg-panel)" }}>
        <div className="cluster" style={{ marginBottom: 8 }}>
          {progress.steps.map((s, i) => <span key={s.id} className={`pill ${s.done ? "good" : i === progress.currentIndex ? "info" : ""}`}>{s.done ? <Icon name="CHECK" size={12} /> : null}Step {i + 1}</span>)}
        </div>
        {progress.complete ? (
          <div className="stack">
            <b style={{ color: "var(--good)", fontSize: 16 }}>You did it. All four steps done.</b>
            <button className="btn go" onClick={() => createLocalMatch("easy")}>Play an easy match</button>
          </div>
        ) : (
          <div className="stack">
            <div className="mission-now">{step.short}</div>
            <div className="muted" style={{ fontSize: 12.5 }}>{stepState.progress}</div>
            <More label="Why does this matter?"><p>{step.story}</p><p><b>You are learning:</b> {step.lesson}</p></More>
            <More label="Show me step by step"><ol style={{ margin: "4px 0", paddingLeft: 18 }}>{step.task.map((t) => <li key={t} style={{ marginBottom: 3 }}>{t}</li>)}</ol></More>
          </div>
        )}
      </div>
      {editor.design.edges.length > 0 ? <div className="grp">
        <h4>Try an attack on yourself</h4>
        <div className="cluster" style={{ gap: 6 }}>
          {Object.values(ATTACKS).map((a) => (
            <button key={a.id} className={`btn small ${test?.id === a.id ? "go" : ""}`} onClick={() => runTest(a.id)} title={ATTACK_INFO[a.id].whatHappens}>
              <Icon name={atkIcon(a.id)} size={16} color={ROLE_COLOR[atkIcon(a.id)]} />{ATTACK_INFO[a.id].fullName}
            </button>))}
        </div>
        {test && outcome ? (
          <div className="issue" style={{ marginTop: 10, borderLeftColor: outcome.dmg >= 15 ? "var(--bad)" : outcome.dmg >= 5 ? "var(--warn)" : "var(--good)" }}>
            <div style={{ padding: "8px 10px", fontSize: 14 }}><b>You would lose {outcome.dmg} health.</b>
              <div className="muted" style={{ fontSize: 12.5 }}>{ATTACK_INFO[test.id].whatHappens}</div>
              {test.id === "KILL" ? <div style={{ fontSize: 12.5, color: "var(--c-cyan)" }}>Tap a piece on the board to choose which one crashes.</div> : null}
              <More label="What went wrong, and how to defend">
                {outcome.top && outcome.top.util > 0.8 ? <p>The {PART_INFO[outcome.top.part].fullName.toLowerCase()} would be {Math.round(outcome.top.util * 100)} percent full.</p> : <p>No piece would be overloaded.</p>}
                {outcome.amp > 1.15 ? <p>Retries would multiply the traffic by {outcome.amp.toFixed(1)} times.</p> : null}
                <p><b>Defence:</b> {ATTACK_INFO[test.id].howToDefend}</p>
              </More>
            </div>
            <div style={{ padding: "0 10px 8px" }}><button className="btn small" onClick={() => setTest(null)}>Back to normal</button></div>
          </div>) : <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Pick one to see where your design breaks. Nothing is lost.</div>}
      </div> : null}
    </>
  );

  return (
    <Frame crumbs={[{ label: "~" }, { label: "siege", onClick: () => go("home") }, { label: "guided first game" }]}
      pills={<><span className="pill info">Practice board: nothing here counts</span><button className="pill" onClick={() => setIntro(true)}>Read the mission again</button></>}
      status={<><span><kbd>Drag</kbd>move a piece</span><span><kbd>Tap</kbd>learn about it</span><span className="sp">${editor.spent} of ${LINKSMASH.budget} spent</span></>}>
      <Panes
        left={<Palette editor={editor} licences={null} board={board} />}
        centre={<>
          <PaneHead title="Your service" meta={test ? `Testing: ${ATTACK_INFO[test.id].fullName}` : "Normal traffic"} />
          <div style={{ position: "relative", flex: "1 1 auto", display: "flex", minHeight: 0 }}>
            <BoardCanvas ref={board} fx={fx.current} editable nodes={nodes} edges={edges} selectedId={editor.selected} linkFrom={editor.linkFrom}
              onTap={(id) => { if (test?.id === "KILL" && id && editor.design.nodes.find((n) => n.id === id)?.part !== "CLIENT" && !editor.linkFrom) setTest({ id: "KILL", target: id }); editor.tap(id); }}
              onMove={editor.move}
              hint={editor.design.nodes.length <= 1 ? "Tap Application server on the left to add it." : editor.linkFrom ? "Tap where it should send requests." : editor.armed ? "Tap another piece to connect them." : "Red means too full."} />
            {intro ? (
              <div className="overlay" role="dialog" aria-label="Your mission">
                <h2>Keep a website running</h2>
                <div className="flow" aria-hidden="true">
                  <span className="stop"><Icon name="CLIENT" size={40} color="var(--c-blue)" />Visitors arrive</span><span className="arrow">›</span>
                  <span className="stop"><Icon name="APP" size={40} color="var(--c-purple)" />You build</span><span className="arrow">›</span>
                  <span className="stop"><Icon name="DB" size={40} color="var(--c-red)" />Links are saved</span>
                </div>
                <p className="lede">Add pieces, connect them, and keep them from turning red. A coach tells you what to fix.</p>
                <button className="btn go big" onClick={() => setIntro(false)}>Start building</button>
                <More label="Read the full story"><p>{LINKSMASH_BRIEF.story}</p><p><b>Your goal:</b> {LINKSMASH_BRIEF.yourGoal}</p></More>
              </div>) : null}
          </div>
        </>}
        right={<Inspector editor={editor} tips={tips} footer={<div className="muted" style={{ fontSize: 12 }}>No timer. No rival.</div>}>{missionPanel}</Inspector>}
        leftTitle="Pieces" rightTitle="Coach" />
    </Frame>
  );
}
