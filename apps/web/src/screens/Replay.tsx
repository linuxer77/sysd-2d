import { useMemo, useState } from "react";
import { apply, createMatch, describeRound, tick, type MatchState, type MoveLog } from "@sysd/match";
import { Frame, Panes, PaneHead } from "../shell/Frame";
import { HealthBar } from "../shell/widgets";
import { BoardCanvas } from "../board/BoardCanvas";
import { useApp } from "../state/store";
import { toBoard } from "./editor";

/** Rebuild the match from its recorded moves and hand back the state after every round. */
function rounds(log: MoveLog): MatchState[] {
  let s = createMatch(log.config);
  const out: MatchState[] = [];
  for (const m of log.moves) {
    s = tick(s, m.now);
    if (m.seat === null || m.intent === null) continue;
    const before = s.siege.log.length;
    const r = apply(s, m.seat, m.intent, m.now);
    if (r.ok) s = r.state;
    if (s.siege.log.length > before) out.push(s);
  }
  const t = tick(s, Number.MAX_SAFE_INTEGER / 2);
  if (t.siege.log.length > (out[out.length - 1]?.siege.log.length ?? 0)) out.push(t);
  return out;
}

export function Replay() {
  const { replayLog, go } = useApp();
  const states = useMemo(() => (replayLog ? rounds(replayLog.log) : []), [replayLog]);
  const [i, setI] = useState(0);
  const s = states[Math.min(i, states.length - 1)];
  if (!replayLog || !s) return <Frame crumbs={[{ label: "~" }, { label: "siege", onClick: () => go("home") }, { label: "replay" }]}><div className="scrollscreen"><div className="center"><h2>Nothing to replay</h2><p className="muted">This match ended before any round was played.</p><button className="btn" onClick={() => go("home")}>Back to the menu</button></div></div></Frame>;
  const log = s.siege.log[s.siege.log.length - 1]!;
  const a = toBoard(s.seats[0].design, s.seats[0].layout), b = toBoard(s.seats[1].design, s.seats[1].layout);
  return (
    <Frame crumbs={[{ label: "~" }, { label: "siege", onClick: () => go("home") }, { label: "replay" }]} status={<span>{replayLog.title}. Every match can be replayed exactly, move for move.</span>}>
      <Panes
        centre={<>
          <HealthBar who={s.seats[0].handle} hp={log.seats[0].hpAfter} />
          <HealthBar who={s.seats[1].handle} hp={log.seats[1].hpAfter} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", flex: "1 1 auto", minHeight: 0 }}>
            <div style={{ display: "flex", borderRight: "1px solid var(--line)" }}><BoardCanvas nodes={a.nodes} edges={a.edges} tag={s.seats[0].handle} /></div>
            <div style={{ display: "flex" }}><BoardCanvas nodes={b.nodes} edges={b.edges} tag={s.seats[1].handle} /></div>
          </div>
        </>}
        right={<><PaneHead title={`Round ${log.round} of ${states.length}`} /><div className="pane-b">
          <div className="cluster" style={{ marginBottom: 10 }}>
            <button className="btn" disabled={i <= 0} onClick={() => setI(i - 1)}>Previous round</button>
            <button className="btn go" disabled={i >= states.length - 1} onClick={() => setI(i + 1)}>Next round</button>
          </div>
          <div className="log">{describeRound(log, 0).map((t, k) => <div key={k}>{t.replace(/^You /, `${s.seats[0].handle} `).replace(/^Your rival /, `${s.seats[1].handle} `).replace(/^Your stack/, `${s.seats[0].handle}'s stack`).replace(/^Your rival's stack/, `${s.seats[1].handle}'s stack`)}</div>)}</div>
        </div></>}
        leftTitle="" rightTitle="Round" />
    </Frame>
  );
}
