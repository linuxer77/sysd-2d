import { useEffect, useMemo, useRef, useState } from "react";
import { PART_INFO } from "@sysd/shared";
import type { Design, PartId } from "@sysd/sim";
import {
  KIND_INFO, UPGRADES, forecast, money, priceOf, reasonFor, rulesetFor, startProblem, summaryLine, trade, upgradeById,
  type RunState, type WaveResult,
} from "@sysd/run";
import { Frame, PaneHead, Panes } from "../../shell/Frame";
import { AllowanceBar, More } from "../../shell/widgets";
import { BoardCanvas, type BoardHandle, type BoardNode } from "../../board/BoardCanvas";
import { Fx } from "../../anim/fx";
import { motionEnabled } from "../../anim/motion";
import { Icon } from "../../icons/Icon";
import type { IconName } from "../../icons/paths";
import { useApp } from "../../state/store";
import { toBoard, useEditor } from "../editor";
import { PartCard, Palette } from "../EditorPanes";
import { loadBest, useRun } from "./useRun";

const CENTRE = { x: 500, y: 320 };
const KIND_ICON: Record<string, IconName> = { busy: "USERS", viral: "SPARK", crawler: "SCAN", bots: "ROBOT", saving: "QUEUE", slow: "TIMER", boss: "ATK_KILL" };
const UPGRADE_TAG = { piece: "New piece", boost: "Boost", money: "Money" } as const;

/** Per-connection traffic and failure share, taken from what the simulator said each piece carried and dropped. */
function flowOf(design: Design, r: WaveResult): { density: Record<string, number>; failing: Record<string, number> } {
  const by = new Map(r.nodes.map((n) => [n.id, n] as const));
  const peak = Math.max(1, ...r.nodes.filter((n) => n.part !== "CLIENT").map((n) => n.load));
  const density: Record<string, number> = {}, failing: Record<string, number> = {};
  for (const e of design.edges) {
    const to = by.get(e.to); if (!to) continue;
    const key = e.from + ">" + e.to;
    density[key] = Math.min(1, to.load / peak);
    failing[key] = to.load > 0 ? Math.min(1, to.dropped / to.load) : 0;
  }
  return { density, failing };
}

export function RunScreen() {
  const go = useApp((s) => s.go);
  const { state, send, restart } = useRun();
  const say = useApp((s) => s.say);
  const act = (i: Parameters<typeof send>[0]): void => { const why = send(i); if (why) say(why); };
  const wave = state.waves[Math.min(state.wave, state.waves.length) - 1];

  return (
    <Frame
      crumbs={[{ label: "~" }, { label: "sysd-2d", onClick: () => go("home") }, { label: "run" }, { label: `wave ${state.wave} of ${state.waves.length}` }]}
      pills={<>
        <span className="pill info">{money(state.money)}</span>
        <button className="pill" onClick={() => { if (window.confirm("Start a brand new run? Your current run will be lost.")) restart(); }}>New run</button>
      </>}
      status={<><span><kbd>Drag</kbd>a piece onto the board</span><span><kbd>Tap</kbd>two pieces to connect them</span><span className="sp">{wave ? KIND_INFO[wave.kind].title : ""}</span></>}>
      {state.phase === "story" ? <Story onStart={() => act({ k: "story.done" })} /> : null}
      {state.phase === "prepare" || state.phase === "story" ? <Prepare key={state.wave} state={state} act={act} /> : null}
      {state.phase === "result" && state.last ? <Result key={state.wave} state={state} last={state.last} onDone={() => act({ k: "result.done" })} /> : null}
      {state.phase === "reward" ? <><Result key={"r" + state.wave} state={state} last={state.last as WaveResult} onDone={() => undefined} quiet /><Reward state={state} onPick={(id) => act({ k: "reward.pick", id })} /></> : null}
      {state.phase === "over" ? <Over state={state} onAgain={restart} onHome={() => go("home")} /> : null}
    </Frame>
  );
}

/* ------------------------------------------------------------------ the story, once */
function Story({ onStart }: { onStart: () => void }) {
  return (
    <div className="battle-scrim" style={{ zIndex: 20, position: "fixed" }}><div className="battle-menu" role="dialog" aria-label="The story" style={{ width: "min(640px,100%)" }}>
      <header style={{ paddingRight: 0 }}><span className="battle-tag">Your service just got popular</span><h2>Keep it standing.</h2>
        <p>People paste a long web address into your service and get back a short link. Tonight, far more people than usual are opening those links, and wave after wave of visitors is on its way.</p></header>
      <div className="move-grid three">
        {([["APP", "var(--c-purple)", "1. Build", "Add pieces and connect them. Visitors come in on the left and flow to the database on the right."], ["PLAY", "var(--c-green)", "2. Watch", "Press start and watch the wave arrive. A visitor who gets an error, or waits too long, is failed."], ["TROPHY", "var(--c-yellow)", "3. Grow", "After every wave, pick a reward. If too many visitors are failed, the run is over."]] as [IconName, string, string, string][]).map(([i, c, t, d]) => (
          <div key={t} className="move" style={{ ["--mv" as string]: c, cursor: "default" }}><span className="mv-ic"><Icon name={i} size={26} color={c} /></span><b>{t}</b><small>{d}</small></div>))}
      </div>
      <footer><button className="btn go big" onClick={onStart}>Start building</button></footer>
    </div></div>
  );
}

/* ------------------------------------------------------------------ prepare: build, then press start */
function Prepare({ state, act }: { state: RunState; act: (i: Parameters<ReturnType<typeof useRun>["send"]>[0]) => void }) {
  const wave = state.waves[state.wave - 1] as RunState["waves"][number];
  const info = KIND_INFO[wave.kind];
  const licences = useMemo(() => Object.fromEntries(state.unlocked.map((p) => [p, 99])) as Partial<Record<PartId, number>>, [state.unlocked]);
  const editor = useEditor(0, licences, { design: state.design, layout: state.layout });
  const board = useRef<BoardHandle | null>(null);
  const fx = useRef(new Fx());
  const rs = useMemo(() => rulesetFor(state.owned), [state.owned]);
  const { cost, refund } = trade(state, editor.design);
  const left = state.money - cost + refund;
  const problem = state.phase === "prepare" ? startProblem(state, editor.design, editor.layout) : null;
  const ready = state.phase === "prepare" && editor.design.edges.length > 0;
  const fc = useMemo(() => (ready ? forecast(state, editor.design) : null), [ready, state, editor.design]);
  const utilOf = useMemo(() => Object.fromEntries((fc?.nodes ?? []).map((n) => [n.id, n.util])), [fc]);
  const b = toBoard(editor.design, editor.layout, utilOf);
  const nodes: BoardNode[] = b.nodes.map((n) => (fc?.crashed === n.id ? { ...n, marked: true } : n));
  const pct = fc && fc.offered ? Math.round((fc.failed / fc.offered) * 100) : 0;
  const sel = editor.design.nodes.find((n) => n.id === editor.selected);
  const hot = (fc?.nodes ?? []).filter((n) => n.part !== "CLIENT" && n.util > 1).sort((x, y) => y.util - x.util).slice(0, 3);

  return (
    <Panes
      left={<Palette editor={editor} licences={licences} board={board} meta={`${money(left)} left`} lockedNote="Unlock it with a reward"
        prices={Object.fromEntries((Object.keys(rs.parts) as PartId[]).map((p) => [p, priceOf(rs, p, state.owned)]))}
        canAfford={(p) => priceOf(rs, p, state.owned) <= left} />}
      centre={<>
        <AllowanceBar left={state.allowance} max={state.allowanceMax} />
        <div className="battle">
          <div className="battle-boards" style={{ gridTemplateColumns: "1fr" }}>
            <div style={{ display: "flex", minHeight: 0 }}>
              <BoardCanvas ref={board} fx={fx.current} editable nodes={nodes} edges={b.edges} selectedId={editor.selected} linkFrom={editor.linkFrom} onTap={editor.tap} onMove={editor.move}
                tag="Your service" hint={editor.design.nodes.length <= 3 && state.wave === 1 ? "Tap a piece on the left to add it. Red means too full." : editor.linkFrom ? "Tap where it should send requests." : editor.armed ? "Tap another piece to connect them." : undefined} />
            </div>
          </div>
          <div className="battle-bar" style={{ flexWrap: "wrap" }}>
            <span style={{ flex: "1 1 240px" }}>
              {problem ? problem : fc ? (fc.failed <= 0.005 * fc.offered ? <><b style={{ color: "var(--good)" }}>Forecast: this holds.</b> No visitor would be failed.</> : <><b style={{ color: pct > 20 ? "var(--bad)" : "var(--warn)" }}>Forecast: {pct} percent of visitors would be failed.</b> {hot[0] ? `The ${PART_INFO[hot[0].part as PartId]?.fullName.toLowerCase() ?? "piece"} is ${Math.round(hot[0].util * 100)} percent full.` : ""}</>) : "Connect your pieces to see a forecast."}
              {cost || refund ? <span className="muted"> Spending {money(cost - refund)}. You will have {money(left)}.</span> : null}
            </span>
            <button className="btn go big" disabled={!!problem} onClick={() => act({ k: "wave.start", design: editor.design, layout: editor.layout })}><Icon name="PLAY" size={15} />Start wave {state.wave}</button>
          </div>
        </div>
      </>}
      right={<>
        <PaneHead title={`Wave ${state.wave} of ${state.waves.length}`} meta={wave.kind === "boss" ? "the big one" : "coming next"} />
        <div className="pane-b" style={{ padding: 0 }}>
          <div className="grp">
            <div className="cluster" style={{ marginBottom: 6 }}><Icon name={KIND_ICON[wave.kind] ?? "USERS"} size={22} color="var(--c-yellow)" /><b style={{ fontSize: 15 }}>{info.title}</b></div>
            <p style={{ margin: "0 0 8px", color: "var(--text-2)", fontSize: 13 }}>{info.what}</p>
            <div className="issue good"><div style={{ padding: "7px 10px", fontSize: 12.5 }}><b>What helps:</b> {info.answer}</div></div>
            {fc?.crashed ? <p className="muted" style={{ fontSize: 12, margin: "8px 0 0" }}>The piece with the spinning ring is the one that will crash.</p> : null}
          </div>
          {hot.length ? <div className="grp"><h4>Too full</h4>{hot.map((n) => <div key={n.id} className="kv"><span className="k">{PART_INFO[n.part as PartId]?.fullName ?? "Piece"}</span><span className="v" style={{ color: "var(--bad)" }}>{Math.round(n.util * 100)} percent</span></div>)}</div> : null}
          {sel ? (
            <div className="grp"><h4>Selected</h4><PartCard part={sel.part} />
              <div className="cluster" style={{ marginTop: 8 }}>
                <button className={`btn small ${editor.linkFrom === sel.id ? "go" : ""}`} onClick={() => editor.startLink(sel.id)}><Icon name="LINK" size={14} />{editor.linkFrom === sel.id ? "Tap where it goes" : "Connect"}</button>
                {sel.part !== "CLIENT" ? <button className="btn small danger" onClick={() => editor.remove(sel.id)}><Icon name="CROSS" size={14} />Sell</button> : null}
              </div>
              {editor.design.edges.filter((e) => e.from === sel.id).map((e) => { const t = editor.design.nodes.find((n) => n.id === e.to); return <div key={e.to} className="cluster" style={{ justifyContent: "space-between", fontSize: 12, marginTop: 6 }}><span>Sends to {t ? PART_INFO[t.part].fullName.toLowerCase() : "?"}</span><button className="btn small" onClick={() => editor.unlink(e.from, e.to)}>Disconnect</button></div>; })}
            </div>) : null}
          <div className="grp">
            <button className="btn small" onClick={editor.tidy}><Icon name="TIDY" size={14} />Tidy the board</button>
            <More label="What have I earned so far?">
              {state.owned.length ? state.owned.map((id) => <p key={id}><b>{upgradeById(id)?.name}.</b> {upgradeById(id)?.text}</p>) : <p>No rewards yet. You pick one after every wave.</p>}
            </More>
          </div>
        </div>
      </>}
      leftTitle="Pieces" rightTitle="Wave" start="centre" />
  );
}

/* ------------------------------------------------------------------ result: watch the wave arrive */
function Result({ state, last, onDone, quiet }: { state: RunState; last: WaveResult; onDone: () => void; quiet?: boolean }) {
  const board = useRef<BoardHandle | null>(null);
  const fx = useRef(new Fx());
  const motion = motionEnabled();
  const [t, setT] = useState(quiet || !motion ? 1 : 0);
  const DURATION = 6000;
  useEffect(() => {
    if (t >= 1) return;
    const start = performance.now();
    const id = window.setInterval(() => { const k = Math.min(1, (performance.now() - start) / DURATION); setT(k); if (k >= 1) window.clearInterval(id); }, 50);
    return () => window.clearInterval(id);
  }, [t >= 1]);   // eslint-disable-line react-hooks/exhaustive-deps

  const shown = Math.round(last.failed * t), servedNow = Math.round((last.offered - last.failed) * t);
  const before = last.allowanceAfter + last.failed;
  const b = toBoard(state.design, state.layout, Object.fromEntries(last.nodes.map((n) => [n.id, n.util])), last.nodes.filter((n) => n.dead).map((n) => n.id));
  const flow = useMemo(() => flowOf(state.design, last), [state.design, last]);
  const fired = useRef(false);
  useEffect(() => {
    if (t < 1 || fired.current || quiet) return;
    fired.current = true;
    for (const n of last.nodes) if (n.dropped > 0) { const node = b.nodes.find((x) => x.id === n.id); if (node) fx.current.burst(node.x, node.y, 26, "var(--c-red)", 3, 0.06); }
    const hot = last.nodes.find((n) => n.id === last.busiest?.id), at = b.nodes.find((x) => x.id === hot?.id) ?? { x: CENTRE.x, y: CENTRE.y };
    fx.current.float(at.x, at.y - 70, last.failed > 0 ? `${last.failed.toLocaleString("en-US")} failed` : "No one failed", last.failed > 0 ? "var(--c-red)" : "var(--c-green)", 22);
    if (last.failed > 0) fx.current.shake(Math.min(10, 2 + (last.failed / last.offered) * 14));
  }, [t, quiet]);   // eslint-disable-line react-hooks/exhaustive-deps

  const ok = last.failed <= 0.005 * last.offered;
  const info = KIND_INFO[last.kind];
  return (
    <Panes centre={<>
      <AllowanceBar left={Math.max(0, before - shown)} max={state.allowanceMax} />
      <div className="battle">
        <div className="battle-boards" style={{ gridTemplateColumns: "1fr" }}>
          <div style={{ display: "flex", minHeight: 0 }}><BoardCanvas ref={board} fx={fx.current} nodes={b.nodes} edges={b.edges} flow={flow} tag={`Wave ${last.wave}: ${info.title}`} /></div>
        </div>
        <div className="battle-dialog" role="status" aria-live="polite" style={{ cursor: "default" }}>
          <span className="bd-ic" style={{ ["--mv" as string]: ok ? "var(--c-green)" : "var(--c-red)" }}><Icon name={ok ? "CHECK" : "HEART"} size={30} color={ok ? "var(--c-green)" : "var(--c-red)"} /></span>
          <div className="bd-text">
            <span className="battle-tag">Wave {last.wave} of {state.waves.length}  ·  {info.title}</span>
            {t < 1 ? <>
              <h3>Visitors arriving…</h3>
              <p><b style={{ color: "var(--good)" }}>{servedNow.toLocaleString("en-US")}</b> served, <b style={{ color: "var(--bad)" }}>{shown.toLocaleString("en-US")}</b> failed so far</p>
            </> : <>
              <h3>{ok ? "Every visitor got an answer." : `${last.failed.toLocaleString("en-US")} visitors were failed.`}</h3>
              <p>{summaryLine(last)} {reasonFor(last)} {last.earned ? `You earned ${money(last.earned)}${last.cleanBonus ? `, including ${money(last.cleanBonus)} for a perfect wave` : ""}.` : ""}</p>
            </>}
          </div>
          {quiet ? null : <div className="bd-actions">{t < 1 ? <button className="btn small" onClick={() => setT(1)}>Skip</button> : <button className="btn go" onClick={onDone}>Continue</button>}</div>}
        </div>
      </div>
    </>} />
  );
}

/* ------------------------------------------------------------------ reward: pick one */
function Reward({ state, onPick }: { state: RunState; onPick: (id: string) => void }) {
  const next = state.waves[state.wave];
  return (
    <div className="battle-scrim" style={{ zIndex: 20, position: "fixed" }}><div className="battle-menu" role="dialog" aria-label="Choose a reward">
      <header style={{ paddingRight: 0 }}><span className="battle-tag">Wave {state.wave} survived</span><h2>Pick one reward</h2>
        <p>{next ? <>Next up: <b>{KIND_INFO[next.kind].title}</b>. {KIND_INFO[next.kind].what}</> : "That was the last wave."}</p></header>
      <div className="move-grid three">
        {state.offered.map((id) => {
          const u = UPGRADES.find((x) => x.id === id);
          if (!u) return null;
          const helps = !!next && u.helps.includes(next.kind);
          const color = u.kind === "piece" ? "var(--c-cyan)" : u.kind === "boost" ? "var(--c-purple)" : "var(--c-yellow)";
          return (
            <button key={id} className="move" style={{ ["--mv" as string]: color }} onClick={() => onPick(id)}>
              <span className="mv-ic"><Icon name={u.kind === "piece" ? "PLUS" : u.kind === "boost" ? "SPARK" : "STAR"} size={26} color={color} /></span>
              <b>{u.name}</b><small>{u.text}</small>
              <em>{UPGRADE_TAG[u.kind]}{helps ? " · helps with the next wave" : ""}</em>
            </button>);
        })}
      </div>
    </div></div>
  );
}

/* ------------------------------------------------------------------ the end */
function Over({ state, onAgain, onHome }: { state: RunState; onAgain: () => void; onHome: () => void }) {
  const won = state.outcome === "won";
  const served = state.history.reduce((a, h) => a + h.served, 0), failed = state.history.reduce((a, h) => a + h.failed, 0);
  const best = loadBest();
  return (
    <div className="battle-scrim" style={{ zIndex: 20, position: "fixed" }}><div className="battle-menu" role="dialog" aria-label="The run is over" style={{ width: "min(560px,100%)" }}>
      <header style={{ paddingRight: 0 }}><span className={`battle-tag ${won ? "" : "warn"}`}>{won ? "You made it" : "The run is over"}</span>
        <h2>{won ? "Your service survived every wave." : "Too many visitors were failed."}</h2>
        <p>{won ? "Visitors kept getting their answers, even through the big one." : `You got through ${Math.max(0, state.history.length - 1)} of ${state.waves.length} waves. ${state.history.length ? reasonFor(state.history[state.history.length - 1] as WaveResult) : ""}`}</p></header>
      <div className="move-grid three">
        <div className="move" style={{ cursor: "default" }}><b>{served.toLocaleString("en-US")}</b><small>visitors served</small></div>
        <div className="move" style={{ cursor: "default" }}><b>{failed.toLocaleString("en-US")}</b><small>visitors failed</small></div>
        <div className="move" style={{ cursor: "default" }}><b>{best ? (best.won ? "All waves" : `${best.waves} of ${state.waves.length}`) : "-"}</b><small>your best run</small></div>
      </div>
      <footer><button className="btn" onClick={onHome}>Back to the front page</button><button className="btn go big" onClick={onAgain}>Play again</button></footer>
    </div></div>
  );
}
