import { Account } from "./screens/Account";
import { Daily, Leaderboard } from "./screens/Boards";
import { Guided } from "./screens/Guided";
import { Home } from "./screens/Home";
import { Learn } from "./screens/Learn";
import { MatchScreen } from "./screens/match/MatchScreen";
import { Online } from "./screens/Online";
import { Replay } from "./screens/Replay";
import { RunScreen } from "./screens/run/RunScreen";
import { useApp } from "./state/store";

export function App() {
  const screen = useApp((s) => s.screen);
  switch (screen) {
    case "run": return <RunScreen />;
    case "learn": return <Learn />;
    case "guided": return <Guided />;
    case "match": return <MatchScreen />;
    case "online": return <Online />;
    case "leaderboard": return <Leaderboard />;
    case "daily": return <Daily />;
    case "replay": return <Replay />;
    case "account": return <Account />;
    default: return <Home />;
  }
}
