import { useEffect, useMemo, useRef, useState } from "react";
import { PART_INFO, LINKSMASH, RULESET } from "@sysd/shared";
import { compile } from "@sysd/sim";
import { Panes, PaneHead } from "../../shell/Frame";
import { BoardCanvas, type BoardHandle } from "../../board/BoardCanvas";
import { Icon } from "../../icons/Icon";
import { toBoard, useAnalysis, useCoach, useEditor } from "../editor";
import { Inspector, Palette } from "../EditorPanes";
import { Guide, send, type MatchProps } from "./common";

export function Build({ session, v, now }: MatchProps) {
  const editor = useEditor(v.seat, v.self.licences, { design: v.self.design, layout: v.self.layout });
  const board = useRef<BoardHandle | null>(null);
  const locked = v.self.locked;
  const analysis = useAnalysis(editor.design);
  const tips = useCoach(editor.design);

  // keep the server's copy of the design up to date (once a second at most)
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (locked) return;
    const t = setTimeout(() => { void session.send({ k: "build.update", design: editor.design, layout: editor.layout }); }, 600);
    return () => clearTimeout(t);
  }, [editor.design, editor.layout, locked, session]);

  const problem = useMemo(() => {
    const c = compile(editor.design, RULESET);
    if (editor.spent > LINKSMASH.budget) return "You are over budget.";
    if (!c.ok) return "Some connections are not valid yet.";
    if (!editor.design.edges.length) return "Connect your pieces first.";
    if (!editor.design.nodes.some((n) => n.part === "DB")) return "You need a database to save links.";
    return null;
  }, [editor.design, editor.spent]);

  const lock = async (): Promise<void> => {
    await session.send({ k: "build.update", design: editor.design, layout: editor.layout });
    await send(session, { k: "build.lock" });
  };

  const { nodes, edges } = toBoard(editor.design, editor.layout, analysis.utilOf);
  const secs = v.deadlineAt ? Math.max(0, Math.ceil((v.deadlineAt - now) / 1000)) : 0;
  const early = Math.min(2, Math.floor(secs / 60));

  return (
    <Panes
      left={<Palette editor={editor} licences={v.self.licences} board={board} />}
      centre={<>
        <Guide title={locked ? "Locked in. Waiting for your rival." : "Build it, then lock it in."}>
          {locked ? `Your rival has ${v.rival.nodeCount} pieces${v.rival.locked ? " and is locked in" : ""}.` : `Connect everything to a database. Finish early with a working design for ${early} extra scouting ${early === 1 ? "point" : "points"}.`}
        </Guide>
        <div style={{ position: "relative", flex: "1 1 auto", display: "flex", minHeight: 0 }}>
          <BoardCanvas ref={board} editable={!locked} nodes={nodes} edges={edges} selectedId={editor.selected} linkFrom={editor.linkFrom}
            onTap={editor.tap} onMove={editor.move}
            hint={locked ? "Locked in." : editor.design.nodes.length <= 1 ? "Drag a piece from the left onto the board to begin." : editor.linkFrom ? "Now tap the piece it should send requests to." : editor.armed ? "To connect it, tap another piece. Tap empty space to cancel." : "Pieces turn red when they are too full."} />
        </div>
      </>}
      right={<Inspector editor={editor} tips={tips}
        footer={<>
          <button className="btn go block big" disabled={locked || !!problem} onClick={() => void lock()}><Icon name="LOCK" size={16} />{locked ? "Locked in" : "Lock in my design"}</button>
          {problem && !locked ? <div className="muted" style={{ fontSize: 12 }}>{problem}</div> : null}
        </>}>
        <div className="grp"><h4>Your rival</h4>
          <div className="kv"><span className="k">{v.rival.handle}</span><span className="v">{v.rival.locked ? "Locked in" : `${v.rival.nodeCount} pieces, $${v.rival.spent}`}</span></div>
        </div>
      </Inspector>}
      leftTitle="Pieces" rightTitle="Coach" />
  );
}
void PART_INFO; void PaneHead;
