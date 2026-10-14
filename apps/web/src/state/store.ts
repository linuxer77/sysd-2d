import { create } from "zustand";
import type { MoveLog } from "@sysd/match";
import { Connection, RemoteSession, api, type Account } from "../session/api";
import type { Session } from "../session/types";

export type Screen = "home" | "run" | "learn" | "guided" | "match" | "online" | "leaderboard" | "daily" | "replay" | "account";
export type Online = "unknown" | "checking" | "up" | "down";

interface App {
  screen: Screen;
  session: Session | null;
  account: Account | null;
  online: Online;
  conn: Connection | null;
  connected: boolean;
  replayLog: { log: MoveLog; title: string } | null;
  notice: string | null;
  go: (s: Screen) => void;
  setSession: (s: Session | null, screen?: Screen) => void;
  leaveMatch: () => void;
  checkServer: () => Promise<void>;
  signIn: (a: Account) => void;
  signOut: () => void;
  startReplay: (log: MoveLog, title: string) => void;
  say: (msg: string | null) => void;
}

const KEY = "siege.account";
const loadAccount = (): Account | null => { try { const v = localStorage.getItem(KEY); return v ? (JSON.parse(v) as Account) : null; } catch { return null; } };
const saveAccount = (a: Account | null): void => { try { if (a) localStorage.setItem(KEY, JSON.stringify(a)); else localStorage.removeItem(KEY); } catch { /* private window */ } };

export const useApp = create<App>((set, get) => ({
  screen: "home", session: null, account: loadAccount(), online: "unknown", conn: null, connected: false, replayLog: null, notice: null,
  go: (screen) => set({ screen }),
  setSession: (session, screen = "match") => { get().session?.close(); set({ session, screen }); },
  leaveMatch: () => { get().session?.close(); set({ session: null, screen: "home" }); },
  say: (notice) => set({ notice }),
  checkServer: async () => {
    set({ online: "checking" });
    const ok = await api.health();
    set({ online: ok ? "up" : "down" });
    const { account, conn } = get();
    if (ok && account && !conn) {
      const c = new Connection(account.token);
      c.onStatus((up) => set({ connected: up }));
      c.onFound((matchId) => { const cur = get().session; if (cur?.matchId === matchId) return; get().setSession(new RemoteSession(c, matchId)); });
      set({ conn: c });
    }
  },
  signIn: (account) => { saveAccount(account); get().conn?.close(); set({ account, conn: null }); void get().checkServer(); },
  signOut: () => { saveAccount(null); get().conn?.close(); set({ account: null, conn: null, connected: false }); },
  startReplay: (log, title) => set({ replayLog: { log, title }, screen: "replay" }),
}));
