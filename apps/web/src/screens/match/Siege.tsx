import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ATTACKS, ATTACK_INFO, LINKSMASH, OPERATION_INFO, PART_INFO, type AttackId } from "@sysd/shared";
import {
  CATEGORY_OF, CATEGORY_TEXT, OP_COOLDOWN, describeRound, modsFor, other, type Category, type OpId, type RoundLog, type SeatRound,
} from "@sysd/match";
import { Panes, PaneHead } from "../../shell/Frame";
import { HealthBar, More } from "../../shell/widgets";
import { BoardCanvas, type BoardHandle } from "../../board/BoardCanvas";
import { Fx } from "../../anim/fx";
import { motionEnabled } from "../../anim/motion";
import { Icon } from "../../icons/Icon";
import type { IconName } from "../../icons/paths";
import { ROLE_COLOR } from "../../icons/paths";
import { atkIcon, opsIcon } from "../../icons/map";
import { useMedia } from "../../shell/hooks";
import { toBoard, useAnalysis } from "../editor";
import { send, type MatchProps } from "./common";

const CENTRE = { x: 500, y: 320 };
const ATK_COLOR: Record<AttackId, string> = { SPIKE: "var(--c-cyan)", FLUSH: "var(--c-yellow)", KILL: "var(--c-red)", LAG: "var(--c-purple)", WRITE_STORM: "var(--c-magenta)" };

/** What an attack looks like landing on a stack. All decoration: the damage was already decided. */
function impact(fx: Fx, at: { x: number; y: number }, id: AttackId, target?: string): void {
  const col = ATK_COLOR[id];
  switch (id) {
    case "SPIKE": fx.beam(20, at.y, at.x, at.y, col, 22); fx.ring(at.x, at.y, col, 260, 5); fx.burst(at.x, at.y, 40, col, 4); fx.shake(7); break;
    case "FLUSH": for (let i = 0; i < 4; i++) fx.burst(at.x + (i - 1.5) * 90, at.y - 70, 14, col, 1.3, 0.22); fx.ring(at.x, at.y, col, 280, 4); fx.shake(4); break;
    case "KILL": fx.beam(at.x, 0, at.x, at.y, col, 14); fx.burst(at.x, at.y, 70, col, 5.5, 0.12); fx.ring(at.x, at.y, "var(--c-yellow)", 190, 8); fx.ring(at.x, at.y, col, 280, 5); fx.shake(14); if (target) fx.flash(target); break;
    case "LAG": for (let i = 0; i < 3; i++) fx.ring(at.x, at.y, col, 170 + i * 50, 4); fx.burst(at.x, at.y, 20, col, 1.4); fx.shake(3); break;
    case "WRITE_STORM": for (let i = 0; i < 5; i++) fx.burst(at.x + (i - 2) * 80, 40, 18, col, 2.4, 0.18); fx.ring(at.x, at.y, col, 230, 4); fx.shake(6); break;
  }
}

interface Beat {
  key: string; icon: IconName; color: string; tag: string; title: string; body: string;
  fx?: () => void; commit?: () => void;
}
const OPS_COLOR: Record<OpId, string> = { SHED: "var(--c-orange)", SCALE: "var(--c-blue)", FAILOVER: "var(--c-green)" };
const partName = (id: string | undefined, nodes: readonly { id: string; part: string }[] | undefined): string => {
  const part = nodes?.find((n) => n.id === id)?.part;
  return part && part in PART_INFO ? PART_INFO[part as keyof typeof PART_INFO].fullName.toLowerCase() : "one piece";
};

export function Siege({ session, v, now }: MatchProps) {
  const narrow = useMedia("(max-width: 900px)");
  const [which, setWhich] = useState<"you" | "rival">("you");
  const youBoard = useRef<BoardHandle | null>(null), rivalBoard = useRef<BoardHandle | null>(null);
  const youFx = useRef(new Fx()), rivalFx = useRef(new Fx());
  const [shown, setShown] = useState({ you: v.self.hp, rival: v.rival.hp });
  const [revealed, setRevealed] = useState(v.rounds.length);
  const processed = useRef(v.rounds.length);
  const [beats, setBeats] = useState<Beat[]>([]);
  const [bi, setBi] = useState(0);

  const foe = other(v.seat);
  const [choice, setChoice] = useState<AttackId | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [warning, setWarning] = useState<Category | "honest">("honest");
  const [ops, setOps] = useState<OpId | null>(null);
  const [peek, setPeek] = useState(false);
  useEffect(() => { setChoice(null); setTarget(null); setWarning("honest"); setOps(null); setPeek(false); }, [v.round]);

  /* ----- a finished round becomes a short story, told one beat at a time */
  useEffect(() => {
    if (processed.current >= v.rounds.length) return;
    const log = v.rounds[v.rounds.length - 1] as RoundLog;
    const idx = v.rounds.length;
    processed.current = idx;
    const me = log.seats[v.seat], them = log.seats[foe];
    const rivalNodes = v.rival.design?.nodes, rivalLayout = v.rival.design?.layout ?? {};
    const at = (layout: Record<string, { x: number; y: number }>, t?: string): { x: number; y: number } => (t && layout[t]) || CENTRE;
    const tag = (n: number, total: number): string => `Round ${idx} of ${v.maxRounds}  ·  ${n} of ${total}`;
    const list: Omit<Beat, "tag">[] = [];

    list.push({ key: "intro", icon: "TELEGRAPH", color: "var(--c-cyan)", title: `Round ${idx}: both moves are revealed`,
      body: "You and your rival chose at the same moment. Now they happen one after the other, so you can see exactly what each one does." });

    const opsBeat = (r: SeatRound, own: boolean): void => {
      if (!r.ops) return;
      const info = OPERATION_INFO[r.ops];
      list.push({ key: `ops-${own ? "me" : "foe"}`, icon: opsIcon(r.ops), color: OPS_COLOR[r.ops], title: `${own ? "You" : v.rival.handle} used ${info.fullName.toLowerCase()}`, body: info.whatHappens,
        fx: () => (own ? youFx : rivalFx).current.ring(CENTRE.x, CENTRE.y, OPS_COLOR[r.ops as OpId], 300, 4) });
    };
    opsBeat(me, true); opsBeat(them, false);

    const attackBeat = (r: SeatRound, own: boolean): void => {
      const who = own ? "You" : v.rival.handle;
      if (!r.attack) { list.push({ key: `hold-${own ? "me" : "foe"}`, icon: "CHECK", color: "var(--c-fg-2)", title: `${who} held back`, body: "No attack this round. Saving it for later." }); return; }
      const info = ATTACK_INFO[r.attack.id];
      const aimed = r.attack.target ? ` It was aimed at the ${partName(r.attack.target, own ? rivalNodes : v.self.design.nodes)}.` : "";
      const warn = r.bluffed ? ` The warning ${own ? "your rival saw" : "you saw"} was a bluff.` : r.telegraph ? ` The warning ${own ? "your rival saw" : "you saw"} was honest.` : "";
      if (r.whiffed) { list.push({ key: `miss-${own ? "me" : "foe"}`, icon: atkIcon(r.attack.id), color: "var(--c-fg-2)", title: `${who} tried ${info.fullName.toLowerCase()}, but it missed`, body: "The piece it was aimed at was not there any more, or it was used too many times." }); return; }
      const layout = own ? rivalLayout : v.self.layout;
      list.push({ key: `atk-${own ? "me" : "foe"}`, icon: atkIcon(r.attack.id), color: ATK_COLOR[r.attack.id], title: `${who} used ${info.fullName.toLowerCase()}!`, body: info.whatHappens + aimed + warn,
        fx: () => impact((own ? rivalFx : youFx).current, at(layout, r.attack?.target), (r.attack as { id: AttackId }).id, r.attack?.target) });
    };
    const resultBeat = (r: SeatRound, own: boolean): void => {
      const lines: string[] = [];
      if (r.damageTaken <= 0) lines.push(own ? "Your service held up. Everyone got their answer." : "Their service held up. No damage.");
      else {
        if (r.readFail > 0.005) lines.push(`${Math.round(r.readFail * 100)} percent of visitors saw an error or waited too long.`);
        const top = r.hottest[0];
        if (top && top.util > 1) lines.push(`The busiest piece was ${Math.round(top.util * 100)} percent full. That is more than it can handle.`);
        if (r.amplification > 1.15) lines.push(`Failed requests were retried, which multiplied the traffic by ${r.amplification.toFixed(1)} times.`);
      }
      const col = r.damageTaken > 0 ? "var(--c-red)" : "var(--c-green)";
      list.push({ key: `res-${own ? "me" : "foe"}`, icon: r.damageTaken > 0 ? "HEART" : "CHECK", color: col,
        title: r.damageTaken > 0 ? `${own ? "Your" : v.rival.handle + "'s"} service lost ${r.damageTaken} health` : `${own ? "Your" : v.rival.handle + "'s"} service took no damage`,
        body: lines.join(" "),
        fx: () => (own ? youFx : rivalFx).current.float(CENTRE.x, 120, r.damageTaken > 0 ? `-${r.damageTaken}` : "No damage", col, r.damageTaken > 14 ? 26 : 18),
        commit: () => setShown((s) => (own ? { ...s, you: r.hpAfter } : { ...s, rival: r.hpAfter })) });
    };
    // what you did, then what it did to them; then what they did, and what it did to you
    attackBeat(me, true); resultBeat(them, false);
    attackBeat(them, false); resultBeat(me, true);

    const lost = me.damageTaken, dealt = them.damageTaken;
    list.push({ key: "sum", icon: dealt > lost ? "TROPHY" : "BULB", color: dealt > lost ? "var(--c-green)" : lost > dealt ? "var(--c-orange)" : "var(--c-cyan)",
      title: dealt > lost ? "You came out ahead this round" : lost > dealt ? "They came out ahead this round" : "An even round",
      body: `You lost ${lost} health and they lost ${dealt}. ${idx >= v.maxRounds ? "That was the last round. The review is next." : "The next round starts soon."}`,
      commit: () => { setShown({ you: me.hpAfter, rival: them.hpAfter }); setRevealed(idx); } });
    setBeats(list.map((b, i) => ({ ...b, tag: tag(i + 1, list.length) })));
    setBi(0);
  }, [v.rounds, v.seat, foe, v.maxRounds, v.self.layout, v.self.design, v.rival.design, v.rival.handle]);

  useEffect(() => { const b = beats[bi]; if (b) { b.fx?.(); b.commit?.(); } }, [beats, bi]);
  const last = beats.length - 1;
  const skipAll = useCallback(() => { for (let i = bi + 1; i < last; i++) beats[i]?.commit?.(); setBi(Math.max(0, last)); }, [beats, bi, last]);
  useEffect(() => {
    if (!beats.length || bi >= last) return;
    if (!motionEnabled()) { skipAll(); return; }
    const t = setTimeout(() => setBi((i) => i + 1), 5200);
    return () => clearTimeout(t);
  }, [beats, bi, last, skipAll]);
  useEffect(() => { if (v.step !== "resolve" && beats.length && bi < last) skipAll(); }, [v.step, beats.length, bi, last, skipAll]);

  /* ----- boards */
  const mods = useMemo(() => modsFor(v.self, LINKSMASH.roundSeconds), [v.version]);   // eslint-disable-line react-hooks/exhaustive-deps
  const analysis = useAnalysis(v.self.design, mods);
  const myKilled = v.self.effects.filter((e) => e.kind === "kill" && e.target).map((e) => e.target as string);
  const mine = toBoard(v.self.design, v.self.layout, analysis.utilOf, myKilled);
  const lastLog = v.rounds[v.rounds.length - 1];
  const hotIds = new Set((lastLog?.seats[foe].hottest ?? []).filter((h) => h.util > 1).map((h) => h.id));
  const rivalKilled = v.rival.effects.filter((e) => e.kind === "kill" && e.target).map((e) => e.target as string);
  const rivalNodes = (v.rival.design?.nodes ?? []).map((n) => { const p = v.rival.design?.layout[n.id] ?? CENTRE; return { id: n.id, part: n.part, x: p.x, y: p.y, dead: rivalKilled.includes(n.id), hot: hotIds.has(n.id) }; });

  /* ----- actions */
  const step = v.step;
  const secs = v.deadlineAt ? Math.max(0, Math.ceil((v.deadlineAt - now) / 1000)) : 0;
  const declared = !!v.self.declared, responded = !!v.self.response;
  const honest: Category | null = choice ? CATEGORY_OF[choice] : null;
  const needTarget = choice === "KILL" && !target;
  const lockAttack = async (): Promise<void> => {
    const attack = choice ? (target && choice === "KILL" ? { id: choice, target } : { id: choice }) : null;
    await send(session, { k: "siege.declare", attack, telegraph: warning === "honest" ? honest : warning });
  };
  const lockDefence = async (o: OpId | null): Promise<void> => { await send(session, { k: "siege.respond", ops: o }); };
  const pickAttack = (id: AttackId): void => { setChoice(id); setWarning("honest"); if (id === "KILL") setPeek(true); else setTarget(null); };

  const incoming = v.rivalWarning;
  const lines = v.rounds.slice(0, revealed).map((r) => ({ round: r.round, text: describeRound(r, v.seat) })).reverse();
  const done = !!v.result && step === "resolve";
  const story = step === "resolve" && beats.length > 0 ? beats[Math.min(bi, last)] : undefined;

  const youBoardEl = <BoardCanvas ref={youBoard} fx={youFx.current} nodes={mine.nodes} edges={mine.edges} tag="Your service" hint={myKilled.length ? "A piece has crashed." : undefined} />;
  const rivalBoardEl = <BoardCanvas ref={rivalBoard} fx={rivalFx.current} nodes={rivalNodes} edges={v.rival.design?.edges ?? []} tag={`${v.rival.handle}'s service`}
    highlight={target ? new Set([target]) : undefined}
    onTap={(id) => { if (choice === "KILL" && id && step === "declare" && !declared) { const p = v.rival.design?.nodes.find((n) => n.id === id); if (p && p.part !== "CLIENT") { setTarget(id); setPeek(false); } } }}
    hint={choice === "KILL" && !target && step === "declare" ? "Tap a piece to crash it." : undefined} />;

  const showAttackMenu = step === "declare" && !declared && !peek;
  const showDefenceMenu = step === "respond" && !responded && !peek;
  const waiting = (step === "declare" && declared) || (step === "respond" && responded);

  return (
    <Panes
      centre={<>
        <HealthBar who="You" hp={shown.you} />
        <HealthBar who={v.rival.handle} hp={shown.rival} />
        <div className="battle">
          {narrow ? <div className="cluster" style={{ padding: "6px 10px" }}><button className={`btn small ${which === "you" ? "go" : ""}`} onClick={() => setWhich("you")}>Your service</button><button className={`btn small ${which === "rival" ? "go" : ""}`} onClick={() => setWhich("rival")}>Their service</button></div> : null}
          <div className="battle-boards" style={{ gridTemplateColumns: narrow ? "1fr" : "1fr 1fr" }}>
            {!narrow || which === "you" ? <div style={{ display: "flex", minHeight: 0, borderRight: narrow ? 0 : "1px solid var(--line)" }}>{youBoardEl}</div> : null}
            {!narrow || which === "rival" ? <div style={{ display: "flex", minHeight: 0 }}>{rivalBoardEl}</div> : null}
          </div>

          {peek && (step === "declare" || step === "respond") ? (
            <div className="battle-bar" role="status">
              <span>{choice === "KILL" && !target && step === "declare" ? "Tap one of their pieces to choose what to crash." : "Have a look at both services, then choose."}</span>
              <button className="btn small go" onClick={() => setPeek(false)}>Back to choices</button>
            </div>) : null}

          {showAttackMenu ? (
            <div className="battle-scrim"><div className="battle-menu" role="dialog" aria-label="Choose your move">
              <header><span className="battle-tag">Round {v.round} of {v.maxRounds}</span><h2>Choose your move</h2>
                <p>Your rival is choosing at the same time. Then both moves happen together.</p><span className="battle-clock">{secs} seconds left</span></header>
              <div className="move-grid">
                {Object.values(ATTACKS).map((a) => { const uses = v.self.attackUses[a.id]; const on = choice === a.id; const col = ATK_COLOR[a.id];
                  return <button key={a.id} className={`move ${on ? "sel" : ""}`} disabled={uses <= 0} onClick={() => pickAttack(a.id)} style={{ ["--mv" as string]: col }}>
                    <span className="mv-ic"><Icon name={atkIcon(a.id)} size={26} color={col} /></span>
                    <b>{ATTACK_INFO[a.id].fullName}</b>
                    <small>{ATTACK_INFO[a.id].whatHappens}</small>
                    <em>{uses > 0 ? `${uses} ${uses === 1 ? "use" : "uses"} left` : "Used up"}</em></button>; })}
                <button className={`move hold ${choice === null ? "sel" : ""}`} onClick={() => { setChoice(null); setTarget(null); }}>
                  <span className="mv-ic"><Icon name="CHECK" size={26} color="var(--c-fg-2)" /></span><b>Hold back</b><small>Skip attacking this round and keep your moves for later.</small><em>Always allowed</em></button>
              </div>
              {choice === "KILL" ? <div className="battle-note">{target ? `Target chosen: ${partName(target, v.rival.design?.nodes)}.` : "You still need to choose a target."} <button className="link" onClick={() => setPeek(true)}>{target ? "Choose a different one" : "Choose a target"}</button></div> : null}
              {choice ? <More label={`Bluff about it (${v.self.feintsLeft} left)`}>
                <p>Your rival sees a warning before they defend. Tell the truth, or bluff to make them waste their defence.</p>
                <label className="row" style={{ cursor: "pointer" }}><input type="radio" name="warn" checked={warning === "honest"} onChange={() => setWarning("honest")} /><span className="nm">Tell the truth{honest ? ": " + CATEGORY_TEXT[honest].title.toLowerCase() : ""}</span></label>
                {v.self.feintsLeft > 0 ? (Object.keys(CATEGORY_TEXT) as Category[]).filter((c) => c !== honest).map((c) => (
                  <label key={c} className="row" style={{ cursor: "pointer" }}><input type="radio" name="warn" checked={warning === c} onChange={() => setWarning(c)} /><span className="nm">Bluff: {CATEGORY_TEXT[c].title.toLowerCase()}</span></label>)) : null}
              </More> : null}
              <footer>
                <button className="btn" onClick={() => setPeek(true)}>Look at the boards first</button>
                <button className="btn go big" disabled={needTarget} onClick={() => void lockAttack()}>{choice ? "Lock in this move" : "Lock in: hold back"}</button>
              </footer>
            </div></div>) : null}

          {showDefenceMenu ? (
            <div className="battle-scrim"><div className="battle-menu" role="dialog" aria-label="Choose your defence">
              <header><span className="battle-tag warn">Round {v.round} of {v.maxRounds}</span>
                <h2>{incoming ? CATEGORY_TEXT[incoming].title : "No warning this round"}</h2>
                <p>{incoming ? `${CATEGORY_TEXT[incoming].detail} It could be a bluff, so think before you spend a defence.` : "Your rival gave no warning, so you cannot tell what is coming."}</p>
                <span className="battle-clock">{secs} seconds left</span></header>
              <div className="move-grid three">
                {(Object.keys(OPERATION_INFO) as OpId[]).map((k) => { const cd = v.self.opsCooldown[k]; const info = OPERATION_INFO[k]; const on = ops === k;
                  return <button key={k} className={`move ${on ? "sel" : ""}`} disabled={cd > 0} onClick={() => setOps(k)} style={{ ["--mv" as string]: OPS_COLOR[k] }}>
                    <span className="mv-ic"><Icon name={opsIcon(k)} size={26} color={OPS_COLOR[k]} /></span><b>{info.fullName}</b><small>{info.whatHappens}</small>
                    <em>{cd > 0 ? `Ready again in ${cd} ${cd === 1 ? "round" : "rounds"}` : "Ready"}</em></button>; })}
              </div>
              <footer>
                <button className="btn" onClick={() => setPeek(true)}>Look at the boards first</button>
                <button className="btn" onClick={() => void lockDefence(null)}>Do not defend</button>
                <button className="btn go big" disabled={!ops} onClick={() => void lockDefence(ops)}>Use this defence</button>
              </footer>
            </div></div>) : null}

          {waiting ? <div className="battle-dialog quiet" role="status"><div><b>Locked in.</b> Waiting for your rival<span className="dots" /></div></div> : null}

          {story ? (
            <div className="battle-dialog" role="status" aria-live="polite" onClick={() => bi < last && setBi(bi + 1)}>
              <span className="bd-ic" style={{ ["--mv" as string]: story.color }}><Icon name={story.icon} size={30} color={story.color} /></span>
              <div className="bd-text"><span className="battle-tag">{story.tag}</span><h3>{story.title}</h3><p>{story.body}</p></div>
              <div className="bd-actions">
                {bi < last ? <><button className="btn go" onClick={(e) => { e.stopPropagation(); setBi(bi + 1); }}>Next</button><button className="btn small" onClick={(e) => { e.stopPropagation(); skipAll(); }}>Skip the rest</button></>
                  : <span className="muted">{done ? "The review is next." : `Next round in ${secs} seconds.`}</span>}
              </div>
            </div>) : null}
        </div>
      </>}
      right={<><PaneHead title={`Round ${v.round} of ${v.maxRounds}`} meta={step === "resolve" ? "results" : step === "respond" ? "defend" : "attack"} />
        <div className="pane-b" style={{ padding: 0 }}>
          <div className="grp"><h4>So far</h4>
            {lines.length === 0 ? <div className="muted" style={{ fontSize: 12 }}>Nothing yet. Each round will be listed here.</div> : lines.map((l) => {
              const log = v.rounds[l.round - 1]!; const me = log.seats[v.seat].damageTaken, them = log.seats[foe].damageTaken;
              return <div key={l.round} className="issue" style={{ borderLeftColor: me > them ? "var(--bad)" : them > me ? "var(--good)" : "var(--line)" }}>
                <div style={{ padding: "7px 10px", fontSize: 13 }}><b>Round {l.round}:</b> you lost {me}, they lost {them}
                  <More label="What happened">{l.text.map((t, i) => <p key={i}>{t}</p>)}</More></div></div>; })}
          </div>
        </div></>}
      leftTitle="" rightTitle="History" start="centre" />
  );
}
