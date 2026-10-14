import { useEffect, useState } from "react";
import type { MoveLog } from "@sysd/match";
import { PageHeader, SiteShell } from "../shell/Site";
import { api, type HistoryRow, type PublicUser } from "../session/api";
import { useApp } from "../state/store";

export function SignIn({ onDone }: { onDone?: () => void }) {
  const signIn = useApp((s) => s.signIn), online = useApp((s) => s.online);
  const [name, setName] = useState(""), [err, setErr] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const submit = async (): Promise<void> => {
    setBusy(true); setErr(null);
    try { const a = await api.guest(name.trim()); signIn(a); onDone?.(); } catch (e) { setErr(e instanceof Error ? e.message : "That did not work."); }
    setBusy(false);
  };
  return (
    <div className="tile" style={{ maxWidth: 480, gap: 12 }}>
      <label htmlFor="handle" style={{ fontWeight: 600 }}>What should other players call you?</label>
      <input id="handle" value={name} onChange={(e) => setName(e.target.value)} placeholder="For example: BuilderBee" maxLength={16} aria-label="Your name"
        onKeyDown={(e) => { if (e.key === "Enter" && name.trim().length >= 3) void submit(); }}
        className="field" />
      <div className="muted" style={{ fontSize: 12 }}>3 to 16 letters, numbers, dashes or underscores.</div>
      {err ? <div style={{ color: "var(--bad)" }}>{err}</div> : null}
      <button className="btn go" disabled={busy || name.trim().length < 3 || online !== "up"} onClick={() => void submit()}>{busy ? "Saving…" : "Save my name"}</button>
      {online !== "up" ? <div className="muted" style={{ fontSize: 12 }}>You need a connection to the game server to choose a name.</div> : null}
    </div>
  );
}

export function Account() {
  const { account, signOut, go, startReplay } = useApp();
  const [me, setMe] = useState<PublicUser | null>(null), [hist, setHist] = useState<HistoryRow[]>([]);
  useEffect(() => {
    if (!account) return;
    api.me(account.token).then(setMe).catch(() => {});
    api.history(account.token).then(setHist).catch(() => {});
  }, [account]);
  const watch = async (id: string, a: string, b: string): Promise<void> => {
    try { const m = await api.match(id); startReplay(m.log as MoveLog, `${a} against ${b}`); } catch { useApp.getState().say("That match could not be loaded."); }
  };
  return (
    <SiteShell active="account">
      <div className="page narrow">
        <PageHeader eyebrow="Your account" title={account ? account.user.handle : "Choose a name"} lede={account ? "Your rating, your record, and replays of your matches." : "No email, no password. Your name is saved on this device."} />
        {!account ? <SignIn onDone={() => go("home")} /> : <>
          <div className="grid cols3">
            <div className="stat"><div className="k">Rating</div><div className="v">{me?.elo ?? account.user.elo}</div></div>
            <div className="stat"><div className="k">Matches played</div><div className="v">{me?.games ?? 0}</div></div>
            <div className="stat"><div className="k">Wins, losses, draws</div><div className="v">{me?.wins ?? 0}, {me?.losses ?? 0}, {me?.draws ?? 0}</div></div>
          </div>
          <h3 style={{ marginTop: 8 }}>Recent matches</h3>
          {hist.length === 0 ? <p className="muted">No matches yet. Play one and it will appear here, with a replay you can watch.</p> : (
            <div className="rows">{hist.map((h) => {
              const mine = h.user0 === account.user.id ? 0 : 1, change = mine === 0 ? h.eloChange0 : h.eloChange1;
              const won = h.winner === String(mine), drew = h.winner === "draw";
              return <div key={h.id} className="r" style={{ flexWrap: "wrap" }}>
                <span><b>{h.handle0}</b> against <b>{h.handle1}</b> <span className="muted">({h.mode === "pvp" ? "against a person" : h.mode === "daily" ? "daily challenge" : "practice"})</span></span>
                <span className="cluster"><span className={`pill ${drew ? "" : won ? "good" : "bad"}`}>{drew ? "Draw" : won ? "Win" : "Loss"}{h.mode === "pvp" ? `, rating ${change >= 0 ? "+" : ""}${change}` : ""}</span><button className="btn small" onClick={() => void watch(h.id, h.handle0, h.handle1)}>Watch replay</button></span>
              </div>; })}</div>)}
          <div><button className="btn danger" onClick={() => { signOut(); go("home"); }}>Forget my name on this device</button></div>
        </>}
      </div>
    </SiteShell>
  );
}
