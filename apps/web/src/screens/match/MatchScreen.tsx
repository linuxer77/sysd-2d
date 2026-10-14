import { Frame } from "../../shell/Frame";
import { Timer } from "../../shell/widgets";
import { useClock, useSnapshot } from "../../shell/hooks";
import { useApp } from "../../state/store";
import type { Session } from "../../session/types";
import { PHASE_LABEL } from "./common";
import { Brief } from "./Brief";
import { Build } from "./Build";
import { Draft } from "./Draft";
import { Recon } from "./Recon";
import { Review } from "./Review";
import { Siege } from "./Siege";

function Inner({ session }: { session: Session }) {
  const { leaveMatch, go } = useApp();
  const snap = useSnapshot(session);
  const now = useClock(session);
  const v = snap?.view;
  const leave = (): void => {
    if (v && v.phase !== "review" && session.kind === "remote" && !window.confirm("Leave this match? Your rival will win.")) return;
    if (v && v.phase !== "review" && session.kind === "local" && !window.confirm("Leave this match? It will not be saved.")) return;
    if (session.kind === "remote" && v && v.phase !== "review") void session.send({ k: "forfeit" });
    leaveMatch();
  };
  // no countdown while there is nothing to decide: it would only look like you were running out of time
  const calm = !!v && ((v.phase === "draft" && v.draft?.stage === "reveal") || (v.phase === "siege" && v.step === "resolve"));
  const crumbs = [{ label: "~" }, { label: "siege", onClick: () => go("home") }, { label: v ? PHASE_LABEL[v.phase] ?? v.phase : "match" }];
  const pills = (
    <>
      {v && v.phase === "siege" ? <span className="pill info">Round {v.round} of {v.maxRounds}</span> : null}
      {v && v.deadlineAt && !calm ? <Timer deadlineAt={v.deadlineAt} now={now} /> : null}
      {v ? <span className="pill">{session.kind === "local" ? "Against the computer" : v.mode === "pvp" ? "Against a person" : v.mode === "daily" ? "Daily challenge" : "Practice"}</span> : null}
      <button className="pill bad" onClick={leave}>Leave</button>
    </>
  );
  if (!v) return <Frame crumbs={crumbs} pills={pills}><div className="scrollscreen"><div className="center"><h2>Getting your match ready…</h2></div></div></Frame>;
  const props = { session, v, now };
  return (
    <Frame crumbs={crumbs} pills={pills} status={<><span>Playing as <b>{v.self.handle}</b> against <b>{v.rival.handle}</b></span><span className="sp">{v.phase === "build" ? `$${v.rival.spent} spent by your rival` : v.phase === "siege" ? "Watch the story, then choose your next move" : ""}</span></>}>
      {v.phase === "lobby" ? <div className="scrollscreen"><div className="center"><h2>Waiting for {v.rival.handle}…</h2><p className="lede">The match begins as soon as you are both here.</p></div></div>
        : v.phase === "brief" ? <Brief {...props} />
        : v.phase === "draft" ? <Draft {...props} />
        : v.phase === "build" ? <Build {...props} />
        : v.phase === "recon" ? <Recon {...props} />
        : v.phase === "siege" ? <Siege {...props} />
        : <Review {...props} />}
    </Frame>
  );
}

export function MatchScreen() {
  const session = useApp((s) => s.session);
  if (!session) return null;
  return <Inner key={session.matchId} session={session} />;
}
