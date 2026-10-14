import { useState } from "react";
import { PageHeader, SiteShell } from "../shell/Site";
import { Icon } from "../icons/Icon";
import { useApp } from "../state/store";
import { SignIn } from "./Account";
import { createServerPractice } from "./online";

export function Online() {
  const { go, account, conn, online, connected, say } = useApp();
  const [code, setCode] = useState(""), [mine, setMine] = useState<string | null>(null), [queued, setQueued] = useState(false), [busy, setBusy] = useState(false);

  if (!account) return <SiteShell active="online"><div className="page narrow"><PageHeader title="First, choose a name" lede="So your friend knows who they are playing." /><SignIn /></div></SiteShell>;

  const run = async (fn: () => Promise<void>): Promise<void> => { setBusy(true); try { await fn(); } finally { setBusy(false); } };
  const ready = online === "up" && !!conn && connected;

  return (
    <SiteShell active="online">
      <div className="page">
        <PageHeader eyebrow={`Playing as ${account.user.handle}, rating ${account.user.elo}`} title="Play against people" lede="Challenge a friend with a room code, or get matched with someone at your level.">
          <span className={`pill ${ready ? "good" : "warn"}`} style={{ alignSelf: "flex-start" }}>{ready ? "Connected" : "Connecting…"}</span>
        </PageHeader>
        <div className="cards c2">
          <div className="tile">
            <div className="cluster"><Icon name="USERS" size={20} color="var(--accent)" /><h3>Play a friend</h3></div>
            <p className="muted" style={{ margin: 0 }}>One of you makes a room code. The other types it in. The match starts as soon as you are both here.</p>
            {mine ? (
              <div className="stack">
                <div className="muted">Your room code. Send it to your friend:</div>
                <div style={{ fontSize: 34, letterSpacing: ".3em", fontWeight: 700, color: "var(--c-cyan)" }} aria-label={`Room code ${mine.split("").join(" ")}`}>{mine}</div>
                <div className="muted">Waiting for your friend to join… keep this page open.</div>
                <button className="btn small" onClick={() => { conn?.socket.emit("room:cancel"); setMine(null); }}>Cancel this room</button>
              </div>
            ) : <button className="btn go" disabled={!ready || busy} onClick={() => void run(async () => { const r = await conn!.call<{ ok: boolean; code?: string; reason?: string }>("room:create"); if (r.ok && r.code) setMine(r.code); else say(r.reason ?? "The room could not be made."); })}>Make a room code</button>}
            <hr style={{ border: 0, borderTop: "1px solid var(--line)", width: "100%" }} />
            <label className="muted" htmlFor="code">Or enter a code your friend gave you:</label>
            <div className="cluster">
              <input id="code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={5} placeholder="ABCDE" aria-label="Room code"
                className="field" style={{ width: 130, letterSpacing: ".2em", textTransform: "uppercase" }} />
              <button className="btn go" disabled={!ready || busy || code.length < 5} onClick={() => void run(async () => { const r = await conn!.call<{ ok: boolean; reason?: string }>("room:join", { code }); if (!r.ok) say(r.reason ?? "That room could not be joined."); })}>Join</button>
            </div>
          </div>
          <div className="tile">
            <div className="cluster"><Icon name="TROPHY" size={20} color="var(--accent)" /><h3>Find an opponent</h3></div>
            <p className="muted" style={{ margin: 0 }}>We match you with someone of a similar rating. If nobody is close, the search widens the longer you wait. Winning raises your rating, losing lowers it.</p>
            {queued
              ? <><div className="cluster"><span className="pill info">Searching…</span><span className="muted">This page will switch to your match automatically.</span></div><button className="btn small" onClick={() => { conn?.socket.emit("queue:leave"); setQueued(false); }}>Stop searching</button></>
              : <button className="btn go" disabled={!ready || busy} onClick={() => void run(async () => { const r = await conn!.call<{ ok: boolean; reason?: string }>("queue:join"); if (r.ok) setQueued(true); else say(r.reason ?? "Could not start searching."); })}>Search for an opponent</button>}
            <hr style={{ border: 0, borderTop: "1px solid var(--line)", width: "100%" }} />
            <div className="cluster"><Icon name="ROBOT" size={18} color="var(--accent)" /><b>Practise on the server</b></div>
            <p className="muted" style={{ margin: 0 }}>Play the computer through the server. It is saved to your history, so you can watch the replay later. It does not change your rating.</p>
            <div className="cluster">
              {(["easy", "normal", "hard"] as const).map((t) => <button key={t} className="btn small" disabled={!ready} onClick={() => void createServerPractice(conn!, { tier: t })}>{t === "easy" ? "Gentle" : t === "normal" ? "Fair" : "Tough"}</button>)}
            </div>
          </div>
        </div>
      </div>
    </SiteShell>
  );
}
