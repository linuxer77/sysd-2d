import { useEffect, useState, type ReactNode } from "react";
import { getMotion, setMotion, type MotionPref } from "../anim/motion";
import { Icon } from "../icons/Icon";
import { useApp, type Screen } from "../state/store";
import { GithubLink, GithubStars, REPO_URL } from "./Github";
import { ThemeMenu } from "./ThemeMenu";

type Active = "home" | "learn" | "leaderboard" | "daily" | "account" | "online";

/** Scroll to a section of the home page, going there first if we are somewhere else. */
export function useGoSection(): (id: string) => void {
  const go = useApp((s) => s.go), screen = useApp((s) => s.screen);
  return (id) => {
    const jump = (): void => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (screen === "home") jump(); else { go("home"); setTimeout(jump, 80); }
  };
}

/** The mark: our own, a traffic spike climbing through a rounded tile. */
export function Logo({ size = 30 }: { size?: number }) {
  return (
    <span className="logo-mark" style={{ width: size, height: size }} aria-hidden="true">
      <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24" fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <defs><linearGradient id="lg" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="var(--accent)" /><stop offset="1" stopColor="var(--violet)" /></linearGradient></defs>
        <path d="M3 19l5-7 3.5 3.5L16 6l5 6" stroke="url(#lg)" /><path d="M17 5h4v4" stroke="url(#lg)" />
      </svg>
    </span>
  );
}

/**
 * The website: sticky blurred header, page, footer. Everything that is not the game board lives in here.
 */
export function SiteShell({ active, children }: { active?: Active; children: ReactNode }) {
  const { go, account, notice, say } = useApp();
  const section = useGoSection();
  const [menu, setMenu] = useState(false);
  useEffect(() => { setMenu(false); }, [active]);
  const page = (label: string, to: Screen, key: Active): ReactNode => (
    <button key={key} className={`s-link ${active === key ? "on" : ""}`} aria-current={active === key ? "page" : undefined} onClick={() => go(to)}>{label}</button>
  );
  return (
    <div className="site">
      <header className="s-head">
        <div className="s-head-in">
          <button className="s-brand" onClick={() => go("home")} aria-label="sysd-2d, home"><Logo /><span>sysd-2d</span></button>
          <div className="s-actions">
            <button className="theme-btn" onClick={() => go("account")}><Icon name="USERS" size={14} /><span className="theme-name">{account ? account.user.handle : "Choose a name"}</span></button>
            <ThemeMenu />
            <GithubStars />
          </div>
        </div>
      </header>
      {notice ? <div className="s-notice" role="status" onClick={() => say(null)}>{notice}<span>Dismiss</span></div> : null}
      <main className="s-main">{children}</main>
    </div>
  );
}

/** A page heading in the site's style: big, tightly set, with a quieter second line. */
export function PageHeader({ eyebrow, title, dim, lede, children }: { eyebrow?: string; title: string; dim?: string; lede?: string; children?: ReactNode }) {
  return (
    <div className="p-head">
      {eyebrow ? <div className="sec-label"><span className="t">{eyebrow}</span></div> : null}
      <h1>{title}{dim ? <><br /><span className="dim">{dim}</span></> : null}</h1>
      {lede ? <p className="p-lede">{lede}</p> : null}
      {children}
    </div>
  );
}
