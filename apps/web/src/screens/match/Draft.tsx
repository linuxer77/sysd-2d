import { useEffect, useState } from "react";
import { PART_INFO, PARTS } from "@sysd/shared";
import { bundleParts, type DraftBundle } from "@sysd/match";
import { Panes, PaneHead } from "../../shell/Frame";
import { More } from "../../shell/widgets";
import { Icon } from "../../icons/Icon";
import { ROLE_COLOR, type IconName } from "../../icons/paths";
import { brief } from "../EditorPanes";
import { Guide, send, type MatchProps } from "./common";

const nameOf = (id: string): string => bundleParts(id).map((p) => PART_INFO[p].fullName).join(" and ");

/** A big, simple choice: the pieces, their price, and one line each. The rest is one click away. */
function BundleCard({ b, can, onPick, picked, tint, result }: { b: DraftBundle; can: boolean; onPick: () => void; picked: boolean; tint: string; result?: { label: string; mine: boolean } | undefined }) {
  const cost = b.parts.reduce((s, p) => s + PARTS[p].cost, 0);
  return (
    <div className="card stack" style={{ borderColor: result ? (result.mine ? "var(--good)" : "var(--c-orange)") : picked ? "var(--accent)" : undefined, opacity: result && !result.mine ? 0.85 : 1, flex: "1 1 240px", alignItems: "center", textAlign: "center", animation: "slidein 260ms var(--ease-overshoot)", gap: 10 }}>
      <div className="cluster" style={{ justifyContent: "center", gap: 14 }}>{b.parts.map((p, i) => <Icon key={i} name={p as IconName} size={52} color={ROLE_COLOR[p]} />)}</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: tint }}>{b.parts.map((p) => PART_INFO[p].fullName).join(" and ")}</div>
      <div className="muted" style={{ fontSize: 13 }}>{brief(PART_INFO[b.parts[0]!].summary, 70)}</div>
      <More label="More">
        {b.parts.map((p, i) => <p key={i}><b>{PART_INFO[p].fullName} (${PARTS[p].cost}):</b> {PART_INFO[p].analogy}</p>)}
        <p>Everything here would cost ${cost} to place.</p>
      </More>
      {result
        ? <div className={`pill ${result.mine ? "good" : "warn"}`} style={{ width: "100%", justifyContent: "center", padding: "10px 8px", fontSize: 14 }}>{result.label}</div>
        : <button className="btn go big" style={{ width: "100%" }} disabled={!can || picked} onClick={onPick}>{picked ? "Chosen" : can ? "Take this" : "Your rival chooses"}</button>}
    </div>
  );
}

export function Draft({ session, v, now }: MatchProps) {
  const d = v.draft!;
  const [sent, setSent] = useState<number | null>(null);
  useEffect(() => { setSent(null); }, [d.index]);
  const secs = v.deadlineAt ? Math.max(0, Math.ceil((v.deadlineAt - now) / 1000)) : null;
  const mine = v.self.picks, theirs = v.rival.picks;
  const reveal = d.stage === "reveal" && d.last ? d.last : null;
  const verdict = (id: string): { label: string; mine: boolean } | undefined => {
    if (!reveal) return undefined;
    const taken = id === reveal.taken;
    return taken ? { label: reveal.pickedByYou ? "You took this" : "Your rival took this", mine: reveal.pickedByYou }
                 : { label: reveal.pickedByYou ? "Your rival gets this" : "You get this", mine: !reveal.pickedByYou };
  };
  const pick = async (choice: "a" | "b"): Promise<void> => { setSent(d.index); if (!(await send(session, { k: "draft.pick", pair: d.index, choice }))) setSent(null); };
  return (
    <Panes
      left={<><PaneHead title="You have" /><div className="pane-b">
        <div className="muted" style={{ fontSize: 12, padding: "2px 6px 8px" }}>Start: load balancer, 2 application servers, database.</div>
        {mine.length === 0 ? <div className="muted" style={{ padding: 8 }}>Nothing won yet.</div> : mine.map((id) => <div key={id} className="row"><span className="ic"><Icon name="CHECK" size={16} color="var(--good)" /></span><span className="nm">{nameOf(id)}</span></div>)}
      </div></>}
      centre={<>
        {reveal
          ? <Guide title={reveal.pickedByYou ? `You took ${nameOf(reveal.taken)}.` : `Your rival took ${nameOf(reveal.taken)}.`}>{reveal.pickedByYou ? `Your rival gets ${nameOf(reveal.left)}.` : `You get ${nameOf(reveal.left)}.`} Next choice in a moment.</Guide>
          : <Guide title={d.yourPick ? "Pick one. Your rival gets the other." : "Your rival is picking. You get what they leave."}>
              Choice {d.index + 1} of {d.total}{secs !== null ? `. ${secs} seconds.` : "."}
            </Guide>}
        <div className="scrollscreen">
          <div className="cluster" style={{ alignItems: "stretch", gap: 14 }}>
            {d.pair ? <>
              <BundleCard b={d.pair.a} tint="var(--c-cyan)" can={d.yourPick && !reveal} result={verdict(d.pair.a.id)} picked={sent === d.index} onPick={() => void pick("a")} />
              <div className="muted" style={{ alignSelf: "center" }}>or</div>
              <BundleCard b={d.pair.b} tint="var(--c-orange)" can={d.yourPick && !reveal} result={verdict(d.pair.b.id)} picked={sent === d.index} onPick={() => void pick("b")} />
            </> : <div className="muted">Getting the next choice ready…</div>}
          </div>
        </div>
      </>}
      right={<><PaneHead title="Rival has" /><div className="pane-b">
        {theirs.length === 0 ? <div className="muted" style={{ fontSize: 12 }}>Nothing yet.</div> : theirs.map((id) => <div key={id} className="row"><span className="nm">{nameOf(id)}</span></div>)}
        <More label="Why a draft?"><p>Pieces are limited. Taking one also stops your rival from having it.</p><p>Choosing only gives you the right to place a piece. You still pay for it from your budget.</p></More>
      </div></>}
      leftTitle="You have" rightTitle="Rival" />
  );
}
