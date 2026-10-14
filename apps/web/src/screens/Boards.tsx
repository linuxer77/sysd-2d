import { useEffect, useState } from "react";
import { PageHeader, SiteShell } from "../shell/Site";
import { api, type DailyInfo, type PublicUser } from "../session/api";
import { createServerPractice } from "./online";
import { useApp } from "../state/store";

export function Leaderboard() {
  const go = useApp((s) => s.go), me = useApp((s) => s.account);
  const [rows, setRows] = useState<PublicUser[] | null>(null), [err, setErr] = useState(false);
  useEffect(() => { api.leaderboard().then(setRows).catch(() => setErr(true)); }, []);
  return (
    <SiteShell active="leaderboard">
      <div className="page narrow">
        <PageHeader eyebrow="Ranked play" title="Leaderboard" lede="The highest rated players. Everyone starts at 1200. Beat people to climb, lose and you slide." />
        {err ? <p className="muted">The leaderboard could not be loaded. Check your connection.</p> : null}
        {rows && rows.length === 0 ? <p className="muted">Nobody has played a ranked match yet. Be the first.</p> : null}
        {rows && rows.length > 0 ? <div className="rows">{rows.map((u, i) => (
          <div key={u.id} className={`r ${me?.user.id === u.id ? "me" : ""}`}>
            <span className="rank"><b>{i + 1}</b></span><span className="grow">{u.handle}</span><span className="muted">{u.wins} wins, {u.losses} losses</span><b style={{ minWidth: 56, textAlign: "right" }}>{u.elo}</b>
          </div>))}</div> : null}
      </div>
    </SiteShell>
  );
}

export function Daily() {
  const go = useApp((s) => s.go), online = useApp((s) => s.online), account = useApp((s) => s.account), conn = useApp((s) => s.conn);
  const [d, setD] = useState<DailyInfo | null>(null), [err, setErr] = useState(false);
  useEffect(() => { api.daily().then(setD).catch(() => setErr(true)); }, []);
  const ready = online === "up" && !!account && !!conn;
  return (
    <SiteShell active="daily">
      <div className="page narrow">
        <PageHeader eyebrow="Changes every day" title="Daily challenge" lede="Everyone plays the same match today: the same draft choices against the same tough opponent. Your score rewards health left, winning, and spending less." />
        <div className="cluster">
          <button className="btn go big" disabled={!ready} onClick={() => void createServerPractice(conn!, { daily: true })}>Play today's challenge</button>
          {!ready ? <span className="muted">{!account ? "Choose a name first." : "You need a connection to the game server."}</span> : null}
          {!account ? <button className="btn" onClick={() => go("account")}>Choose a name</button> : null}
        </div>
        <h3>Today's scores {d ? `(${d.day})` : ""}</h3>
        {err ? <p className="muted">Scores could not be loaded.</p> : null}
        {d && d.board.length === 0 ? <p className="muted">No scores yet today. Be the first.</p> : null}
        {d && d.board.length > 0 ? <div className="rows">{d.board.map((b, i) => <div key={b.handle} className="r"><span className="rank"><b>{i + 1}</b></span><span className="grow">{b.handle}</span><span className="muted">{b.won ? "Won" : "Lost"}, {b.hp} health left, ${b.spent} spent</span><b style={{ minWidth: 56, textAlign: "right" }}>{b.score}</b></div>)}</div> : null}
      </div>
    </SiteShell>
  );
}
