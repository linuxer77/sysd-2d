/**
 * A theme is only its BASE palette. Every other colour in the game and the site (hover states, success
 * and danger tints, the board, the effects) is derived from these with colour mixing in tokens.css, so a
 * new theme is about twenty values and nothing else.
 */
export interface Theme {
  id: string;
  name: string;
  /** the colour shown on the theme's dot and card */
  swatch: string;
  vars: Record<string, string>;
}

const base = (v: {
  bg: string; dark: string; root: string; panel: string; panel2: string; hl: string; sel: string; border: string;
  fg: string; fg2: string; dim: string;
  blue: string; cyan: string; teal: string; green: string; yellow: string; orange: string; red: string; purple: string; magenta: string; steel: string;
  accent: string;
}): Record<string, string> => ({
  "--c-bg": v.bg, "--c-bg-dark": v.dark, "--c-root": v.root, "--c-panel": v.panel, "--c-panel-2": v.panel2, "--c-hl": v.hl, "--c-sel": v.sel, "--c-border": v.border,
  "--c-fg": v.fg, "--c-fg-2": v.fg2, "--c-dim": v.dim,
  "--c-blue": v.blue, "--c-cyan": v.cyan, "--c-teal": v.teal, "--c-green": v.green, "--c-yellow": v.yellow, "--c-orange": v.orange,
  "--c-red": v.red, "--c-purple": v.purple, "--c-magenta": v.magenta, "--c-steel": v.steel, "--accent": v.accent,
});

export const THEMES: readonly Theme[] = [
  { id: "tokyo-night", name: "Tokyo Night", swatch: "#7aa2f7", vars: base({
    bg: "#1a1b26", dark: "#16161e", root: "#13141c", panel: "#1f2335", panel2: "#222536", hl: "#292e42", sel: "#283457", border: "#2a2e45",
    fg: "#c0caf5", fg2: "#a9b1d6", dim: "#565f89",
    blue: "#7aa2f7", cyan: "#7dcfff", teal: "#73daca", green: "#9ece6a", yellow: "#e0af68", orange: "#ff9e64", red: "#f7768e", purple: "#bb9af7", magenta: "#ff007c", steel: "#9aa5ce",
    accent: "#7aa2f7" }) },
  { id: "dracula", name: "Dracula", swatch: "#bd93f9", vars: base({
    bg: "#282a36", dark: "#21222c", root: "#1b1c25", panel: "#2f3142", panel2: "#323446", hl: "#3b3e52", sel: "#44475a", border: "#44475a",
    fg: "#f8f8f2", fg2: "#d6d6e4", dim: "#7e87b0",
    blue: "#8fa8ff", cyan: "#8be9fd", teal: "#6ff0c4", green: "#50fa7b", yellow: "#f1fa8c", orange: "#ffb86c", red: "#ff6e6e", purple: "#bd93f9", magenta: "#ff79c6", steel: "#a4acd0",
    accent: "#bd93f9" }) },
  { id: "catppuccin", name: "Catppuccin", swatch: "#f5c2e7", vars: base({
    bg: "#1e1e2e", dark: "#181825", root: "#11111b", panel: "#26263a", panel2: "#2a2a3e", hl: "#313244", sel: "#3a3b52", border: "#45475a",
    fg: "#cdd6f4", fg2: "#bac2de", dim: "#6c7086",
    blue: "#89b4fa", cyan: "#89dceb", teal: "#94e2d5", green: "#a6e3a1", yellow: "#f9e2af", orange: "#fab387", red: "#f38ba8", purple: "#cba6f7", magenta: "#f5c2e7", steel: "#9399b2",
    accent: "#cba6f7" }) },
  { id: "rose-pine", name: "Rosé Pine", swatch: "#ebbcba", vars: base({
    bg: "#191724", dark: "#14121f", root: "#100e1a", panel: "#1f1d2e", panel2: "#232136", hl: "#26233a", sel: "#2f2b47", border: "#403d52",
    fg: "#e0def4", fg2: "#bdb9d6", dim: "#6e6a86",
    blue: "#7fa6d9", cyan: "#9ccfd8", teal: "#7fc4c0", green: "#8fcf9e", yellow: "#f6c177", orange: "#ea9a97", red: "#eb6f92", purple: "#c4a7e7", magenta: "#d98bbd", steel: "#908caa",
    accent: "#c4a7e7" }) },
  { id: "everforest", name: "Everforest", swatch: "#a7c080", vars: base({
    bg: "#2d353b", dark: "#232a2e", root: "#1d2326", panel: "#343f44", panel2: "#384348", hl: "#3d484d", sel: "#475258", border: "#4f5b58",
    fg: "#d3c6aa", fg2: "#b9ae94", dim: "#859289",
    blue: "#7fbbb3", cyan: "#83c9c0", teal: "#83c092", green: "#a7c080", yellow: "#dbbc7f", orange: "#e69875", red: "#e67e80", purple: "#d699b6", magenta: "#e08fb0", steel: "#a0aca3",
    accent: "#a7c080" }) },
];

export const DEFAULT_THEME = "tokyo-night";
export const themeById = (id: string): Theme => THEMES.find((t) => t.id === id) ?? (THEMES[0] as Theme);
