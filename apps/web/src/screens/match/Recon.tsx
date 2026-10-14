import { PART_INFO } from "@sysd/shared";
import { Panes, PaneHead } from "../../shell/Frame";
import { BoardCanvas } from "../../board/BoardCanvas";
import { Icon } from "../../icons/Icon";
import { Guide, send, type MatchProps } from "./common";

export function Recon({ session, v, now }: MatchProps) {
  const rival = v.rival.design;
  const secs = v.deadlineAt ? Math.max(0, Math.ceil((v.deadlineAt - now) / 1000)) : 0;
  const points = v.self.probesLeft;
  const nodes = (rival?.nodes ?? []).map((n) => { const p = rival?.layout[n.id] ?? { x: 500, y: 320 }; return { id: n.id, part: n.part, x: p.x, y: p.y }; });
  const edges = rival?.edges ?? [];
  const unknown = nodes.filter((n) => n.part === "UNKNOWN").length;
  const pol = rival?.policy;
  return (
    <Panes
      left={<><PaneHead title="What to look for" /><div className="pane-b">
        <div className="issue idea"><button onClick={(e) => e.currentTarget.nextElementSibling?.toggleAttribute("hidden")}><span style={{ width: 8, height: 8, borderRadius: 4, background: "var(--c-cyan)" }} />Only one database</button><div className="body" hidden><p>Crash it and their whole service stops.</p></div></div>
        <div className="issue idea"><button onClick={(e) => e.currentTarget.nextElementSibling?.toggleAttribute("hidden")}><span style={{ width: 8, height: 8, borderRadius: 4, background: "var(--c-cyan)" }} />No cache</button><div className="body" hidden><p>A sudden crowd lands straight on the database.</p></div></div>
        <div className="issue idea"><button onClick={(e) => e.currentTarget.nextElementSibling?.toggleAttribute("hidden")}><span style={{ width: 8, height: 8, borderRadius: 4, background: "var(--c-cyan)" }} />Retries, no safety switch</button><div className="body" hidden><p>A small overload can snowball. Reveal their settings to check.</p></div></div>
        <div className="issue idea"><button onClick={(e) => e.currentTarget.nextElementSibling?.toggleAttribute("hidden")}><span style={{ width: 8, height: 8, borderRadius: 4, background: "var(--c-cyan)" }} />A waiting line</button><div className="body" hidden><p>Then a burst of new links hurts them less.</p></div></div>
      </div></>}
      centre={<>
        <Guide title="Scout your rival. Tap a question mark to reveal it.">
          {points} {points === 1 ? "point" : "points"} left. {secs} seconds. {unknown === 0 ? "Everything is revealed." : `${unknown} still hidden.`}
        </Guide>
        <BoardCanvas nodes={nodes} edges={edges} tag="Your rival's design"
          onTap={(id) => { if (id && !v.self.reconDone) void send(session, { k: "recon.probe", target: { kind: "part", nodeId: id } }); }}
          hint={points > 0 ? "Tap a ? to reveal it." : "No points left."} />
      </>}
      right={<><PaneHead title="Your scouting" meta={`${points} left`} /><div className="pane-b" style={{ padding: 0 }}>
        <div className="grp"><h4>Reveal their settings</h4>
          {pol ? <div className="stack" style={{ fontSize: 12.5 }}>
            <div className="kv"><span className="k">They wait</span><span className="v">{pol.readTimeoutMs} milliseconds</span></div>
            <div className="kv"><span className="k">Retries</span><span className="v">{pol.retries} {pol.retries === 1 ? "time" : "times"}</span></div>
            <div className="kv"><span className="k">Safety switch</span><span className="v">{pol.breaker ? "On" : "Off"}</span></div>
            {pol.retries >= 2 && !pol.breaker ? <div className="tip warning" style={{ marginBottom: 0 }}><p style={{ margin: 0 }}>Retries with no safety switch. A traffic spike could make them hurt themselves.</p></div> : null}
          </div> : <>
            <p className="muted" style={{ margin: "0 0 8px", fontSize: 12 }}>Costs 2 points.</p>
            <button className="btn go block" disabled={points < 2 || v.self.reconDone} onClick={() => void send(session, { k: "recon.probe", target: { kind: "policy" } })}><Icon name="SCAN" size={16} />Reveal their settings</button></>}
        </div>
        <div className="grp"><h4>Pieces you have found</h4>
          {nodes.filter((n) => n.part !== "UNKNOWN" && n.part !== "CLIENT").length === 0 ? <div className="muted" style={{ fontSize: 12 }}>None yet.</div>
            : nodes.filter((n) => n.part !== "UNKNOWN" && n.part !== "CLIENT").map((n) => <div key={n.id} style={{ fontSize: 12.5, padding: "2px 0" }}>{PART_INFO[n.part as keyof typeof PART_INFO].fullName}</div>)}
        </div>
        <div className="grp">
          <button className="btn go block big" disabled={v.self.reconDone} onClick={() => void send(session, { k: "recon.done" })}>{v.self.reconDone ? "Waiting for your rival…" : "I am done scouting"}</button>
          
        </div>
      </div></>}
      leftTitle="Look for" rightTitle="Scout" start="centre" />
  );
}
