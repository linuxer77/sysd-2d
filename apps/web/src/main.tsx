import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initMotion } from "./anim/motion";
import { initTheme } from "./theme/theme";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/site.css";

initTheme();
initMotion();
createRoot(document.getElementById("root") as HTMLElement).render(<StrictMode><App /></StrictMode>);
