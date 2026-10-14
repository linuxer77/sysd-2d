import { useMemo } from "react";
import { ATTACK_INFO, LINKSMASH, PART_INFO, RULESET, coach } from "@sysd/shared";
import { describeRound, explainResult, other, type RoundLog } from "@sysd/match";
import { Panes, PaneHead } from "../../shell/Frame";
import { More } from "../../shell/widgets";
import { BoardCanvas } from "../../board/BoardCanvas";
import { LocalSession } from "../../session/local";
import { api } from "../../session/api";
import { useApp } from "../../state/store";
import { toBoard, useAnalysis } from "../editor";
import { CoachTips } from "../EditorPanes";
import { createLocalMatch } from "../newMatch";
import { Guide, type MatchProps } from "./common";

const TERM_TEXT = {
  availability: "visitors were turned away or gave up",
  latency: "answers came back too slowly",
  writes: "new links could not be saved",
  dataLoss: "work was lost or done twice",
  staleness: "answers came from out-of-date copies",
} as const;

export function Review({ session, v }: MatchProps) {
  const { leaveMatch, startReplay, say } = useApp();
  const result = v.result;
  const seat = v.seat, foe = other(seat);
  const out = result ? explainResult(result, seat) : { headline: "The match is over", why: "" };
  const won = result?.winner === seat;
  const tips = useMemo(() => coach(v.self.design, RULESET, LINKSMASH), [v.self.design]);
  const mineAnalysis = useAnalysis(v.self.design);
  const mine = toBoard(v.self.design, v.self.layout, mineAnalysis.utilOf);
  const rd = v.rival.design;
  const rivalNodes = (rd?.nodes ?? []).map((n) => ({ id: n.id, part: n.part, x: rd?.layout[n.id]?.x ?? 500, y: rd?.layout[n.id]?.y ?? 320 }));

  // the round that hurt you most, and what kind of harm it was
  const worst: RoundLog | undefined = [...v.rounds].sort((a, b) => b.seats[seat].damageTaken - a.seats[seat].damageTaken)[0];
  const ws = worst?.seats[seat];
  const topTerm = ws ? (Object.entries(ws.breakdown).filter(([k]) => k !== "total").sort((a, b) => (b[1] as number) - (a[1] as number))[0]) : undefined;
  const hurtBy = worst?.seats[foe].attack;

  const watch = async (): Promise<void> => {
    try {
      if (session instanceof LocalSession) startReplay(session.log(), "Your match against the computer");
      else { const m = await api.match(session.matchId); startReplay(m.log, `${m.handle0} against ${m.handle1}`); }
    } catch { say("The replay could not be loaded."); }
  };

  return (
    <Panes
      centre={<>
        <Guide title={out.headline}>{out.why}</Guide>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", flex: "1 1 auto", minHeight: 0 }}>
          <div style={{ display: "flex", borderRight: "1px solid var(--line)" }}><BoardCanvas nodes={mine.nodes} edges={mine.edges} tag="Your service" /></div>
          <div style={{ display: "flex" }}><BoardCanvas nodes={rivalNodes} edges={rd?.edges ?? []} tag={`${v.rival.handle}'s service, now revealed`} /></div>
        </div>
      </>}
      right={<><PaneHead title="What we learned" meta={won ? "you won" : result?.winner === "draw" ? "a draw" : "you lost"} />
        <div className="pane-b" style={{ padding: 0 }}>
          <div className="grp">
            <div className="kv"><span className="k">Your health</span><span className="v">{v.self.hp} of 100</span></div>
            <div className="kv"><span className="k">{v.rival.handle}</span><span className="v">{v.rival.hp} of 100</span></div>
          </div>
          {ws && worst && ws.damageTaken > 0 ? (
            <div className="grp"><h4>Your worst round</h4>
              <div className="issue problem"><div style={{ padding: "8px 10px", fontSize: 13 }}><b>Round {worst.round}: you lost {ws.damageTaken}.</b>
                <div className="muted">{hurtBy ? `${v.rival.handle} used ${ATTACK_INFO[hurtBy.id].fullName.toLowerCase()}.` : "Your own design was the problem."}</div>
                <More label="Why, and what to do">
                  <p>Most of the harm: {topTerm ? TERM_TEXT[topTerm[0] as keyof typeof TERM_TEXT] : "things were overloaded"}.</p>
                  {ws.hottest[0] && ws.hottest[0].util > 1 && ws.hottest[0].part !== "UNKNOWN" ? <p>Your {PART_INFO[ws.hottest[0].part].fullName.toLowerCase()} was {Math.round(ws.hottest[0].util * 100)} percent full.</p> : null}
                  {hurtBy ? <p><b>Next time:</b> {ATTACK_INFO[hurtBy.id].howToDefend}</p> : null}
                </More></div></div></div>) : null}
          <div className="grp"><h4>Fix next time</h4><CoachTips tips={tips} max={3} /></div>
          <div className="grp"><More label="Round by round"><div className="log">{v.rounds.map((r) => <div key={r.round}><b>Round {r.round}</b>{describeRound(r, seat).map((t, i) => <div key={i} style={{ color: "var(--text-2)" }}>{t}</div>)}</div>)}</div></More></div>
          <div className="grp stack">
            <button className="btn go block big" onClick={() => (session.kind === "local" ? createLocalMatch("normal") : leaveMatch())}>{session.kind === "local" ? "Play again" : "Back to the menu"}</button>
            <button className="btn block" onClick={() => void watch()}>Watch the replay</button>
            <button className="btn block" onClick={leaveMatch}>Menu</button>
          </div>
        </div></>}
      leftTitle="" rightTitle="Lessons" start="centre" />
  );
}
