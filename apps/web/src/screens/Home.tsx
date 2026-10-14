import { createLocalMatch } from "./newMatch";
import { SiteShell } from "../shell/Site";
import { Icon } from "../icons/Icon";
import { useApp } from "../state/store";
import { Playground } from "./landing/Playground";
import { hasRunInProgress } from "./run/useRun";

export function Home() {
  const go = useApp((s) => s.go);
  const resumable = hasRunInProgress();
  return (
    <SiteShell active="home">
      <section className="hero3">
        <div className="wrap">
          <h1>Survive <span className="grad">every spike.</span></h1>
          <p className="sub">A free game about keeping a website standing. Build it, survive waves of visitors, and pick upgrades as you go. Open source.</p>
          <div className="hero-actions">
            <button className="sbtn fill" onClick={() => go("run")}><Icon name="PLAY" size={15} />{resumable ? "Continue your run" : "Start a run"}</button>
            <button className="sbtn" onClick={() => go("learn")}><Icon name="BOOK" size={15} />How it works</button>
          </div>
        </div>
      </section>
      <Playground />
      <div className="wrap other-ways">
        <details>
          <summary>Other ways to play</summary>
          <div className="other-grid">
            <button className="sbtn sm" onClick={() => go("guided")}>Guided first game</button>
            <button className="sbtn sm" onClick={() => createLocalMatch("easy")}>Versus the computer: easy</button>
            <button className="sbtn sm" onClick={() => createLocalMatch("normal")}>Versus the computer: medium</button>
            <button className="sbtn sm" onClick={() => createLocalMatch("hard")}>Versus the computer: hard</button>
            <button className="sbtn sm" onClick={() => go("online")}>With a friend</button>
            <button className="sbtn sm" onClick={() => go("daily")}>Daily challenge</button>
            <button className="sbtn sm" onClick={() => go("leaderboard")}>Leaderboard</button>
          </div>
        </details>
      </div>
    </SiteShell>
  );
}
