import { useMemo, useRef, useState } from "react";
import { PART_INFO } from "@sysd/shared";
import type { PartId } from "@sysd/sim";
import { Icon } from "../../icons/Icon";
import { BoardCanvas, type BoardHandle } from "../../board/BoardCanvas";
import { Fx } from "../../anim/fx";
import { toBoard, useEditor } from "../editor";
import { Palette } from "../EditorPanes";
import { MOMENTS, START, momentMods, run, startLayout, type Moment } from "./designs";

const name = (p: string): string => (p in PART_INFO ? PART_INFO[p as PartId].fullName.toLowerCase() : "piece");

/** The real editor and the real simulator, right on the front page. Build something, then break it. */
export function Playground() {
  const editor = useEditor(0, null, { design: START, layout: startLayout() });
  const board = useRef<BoardHandle | null>(null);
  const fx = useRef(new Fx());
  const [moment, setMoment] = useState<Moment>("normal");

  const calm = useMemo(() => run(editor.design, momentMods(editor.design, {}, "normal")), [editor.design]);
  const mods = useMemo(() => momentMods(editor.design, calm?.util ?? {}, moment), [editor.design, calm, moment]);
  const out = useMemo(() => run(editor.design, mods), [editor.design, mods]);
  const util = out?.util ?? {};
  const b = toBoard(editor.design, editor.layout, util);
  const health = out ? Math.max(0, 100 - out.hurt) : null;
  const hottest = Object.entries(util).sort((x, y) => y[1] - x[1])[0];
  const hotPart = hottest ? editor.design.nodes.find((n) => n.id === hottest[0])?.part : undefined;
  const label = MOMENTS.find((m) => m.id === moment)?.label ?? "";

  return (
    <div className="wrap play-wrap">
      <div className="demo" role="group" aria-label="Playground">
        <div className="demo-bar"><Icon name="TERMINAL" size={15} color="var(--accent)" /><span>~</span><span className="sep">/</span><span>playground</span><span className="sep">/</span><span className="cur">{label.toLowerCase()}</span>
          <span className="r"><button className="pill" onClick={() => { editor.load(START, startLayout()); setMoment("normal"); }}>Start over</button></span></div>
        <div className="demo-body play">
          <div className="demo-side"><Palette editor={editor} licences={null} board={board} /></div>
          <div className="demo-main">
            <BoardCanvas ref={board} fx={fx.current} editable nodes={b.nodes} edges={b.edges} selectedId={editor.selected} linkFrom={editor.linkFrom} onTap={editor.tap} onMove={editor.move}
              hint={editor.linkFrom ? "Tap where it should send requests." : editor.armed ? "Tap another piece to connect them." : "Drag a piece in. Tap two to connect them."} />
          </div>
          <div className="demo-side r">
            <h5>Break it</h5>
            <div className="play-moments">{MOMENTS.map((m) => <button key={m.id} className={`chip-btn ${moment === m.id ? "on" : ""}`} aria-pressed={moment === m.id} onClick={() => setMoment(m.id)}>{m.label}</button>)}</div>
            <div className="play-score">
              {health === null ? <p className="muted">Connect the visitors to a piece, and the pieces after it, to see what happens.</p> : <>
                <div className="play-hp"><span>Health left</span><b style={{ color: health > 60 ? "var(--good)" : health > 30 ? "var(--warn)" : "var(--bad)" }}>{health}</b><small>of 100</small></div>
                <div className="play-bar"><span style={{ width: `${health}%`, background: health > 60 ? "var(--good)" : health > 30 ? "var(--warn)" : "var(--bad)" }} /></div>
                {hottest && hottest[1] > 1 ? <p>The {name(hotPart ?? "")} is {Math.round(hottest[1] * 100)} percent full. Add another one, or something to take work off it.</p> : <p>Nothing is overloaded. Try a harder moment.</p>}
              </>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
