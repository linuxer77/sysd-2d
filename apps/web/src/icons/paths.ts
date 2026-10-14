/**
 * The single source of truth for every icon. 24x24, stroke only, drawn with stroke-width 1.6 and round
 * caps. The SAME strings feed the DOM (<svg>) and the canvas (Path2D), so a piece looks identical in the
 * palette and on the board. The first ten are carried over byte for byte from the approved prototype.
 */
export const ICON_D = {
  /* the pieces */
  CLIENT:   "M3 5h18v11H3z M8 20h8 M12 16v4",
  LB:       "M2 12h4 M6 12l5-6h9 M6 12h14 M6 12l5 6h9",
  APP:      "M3 4h18v4.5H3z M3 10h18v4.5H3z M3 16h18v4.5H3z M6.3 6.2h1.2 M6.3 12.2h1.2 M6.3 18.2h1.2",
  CACHE:    "M13 2L4 14h7l-1 8 9-12h-7z",
  CDN:      "M12 2a10 10 0 100 20 10 10 0 000-20z M2.5 12h19 M12 2a15.5 15.5 0 010 20 15.5 15.5 0 010-20z",
  DB:       "M12 2.5c4.4 0 8 1.2 8 2.8s-3.6 2.8-8 2.8-8-1.2-8-2.8 3.6-2.8 8-2.8z M4 5.3v13.4c0 1.6 3.6 2.8 8 2.8s8-1.2 8-2.8V5.3 M4 12c0 1.6 3.6 2.8 8 2.8s8-1.2 8-2.8",
  REPLICA:  "M8 2.5c3.2 0 5.8 .9 5.8 2.1S11.2 6.7 8 6.7 2.2 5.8 2.2 4.6 4.8 2.5 8 2.5z M2.2 4.6v6.2c0 1.2 2.6 2.1 5.8 2.1 M16 9.8c3.2 0 5.8 .9 5.8 2.1s-2.6 2.1-5.8 2.1-5.8-.9-5.8-2.1 2.6-2.1 5.8-2.1z M10.2 11.9v7.5c0 1.2 2.6 2.1 5.8 2.1s5.8-.9 5.8-2.1v-7.5",
  QUEUE:    "M3.5 5h17 M3.5 10h17 M3.5 15h17 M3.5 20h10",
  WORKER:   "M12 2.2v3 M12 18.8v3 M2.2 12h3 M18.8 12h3 M5.1 5.1l2.1 2.1 M16.8 16.8l2.1 2.1 M18.9 5.1l-2.1 2.1 M7.2 16.8l-2.1 2.1 M12 8.2a3.8 3.8 0 100 7.6 3.8 3.8 0 000-7.6z",
  RATELIMIT:"M3 4.5h18l-7 8.2v6.8l-4 2v-8.8z",
  UNKNOWN:  "M12 2.5a9.5 9.5 0 100 19 9.5 9.5 0 000-19z M9.2 9.2a2.9 2.9 0 115 1.9c-.9.8-2.2 1.3-2.2 2.7 M12 16.8v.2",
  /* attacks */
  ATK_SPIKE:  "M3 19l4-6 3 3 4-9 3 4 4-6 M16 4h4v4",
  ATK_FLUSH:  "M13 2L4 14h7l-1 8 9-12h-7z M3 5l2 1 M21 5l-2 1 M2 12h2",
  ATK_KILL:   "M12 2.5l8 4.5v10l-8 4.5-8-4.5V7z M8.5 9l7 6 M15.5 9l-7 6",
  ATK_LAG:    "M6 3h12 M6 21h12 M7 3c0 5 5 6 5 9s-5 4-5 9 M17 3c0 5-5 6-5 9s5 4 5 9",
  ATK_STORM:  "M4 3l4 5 M12 2v8 M20 3l-4 5 M7 14c0-1.5 2.2-2.7 5-2.7s5 1.2 5 2.7-2.2 2.7-5 2.7-5-1.2-5-2.7z M7 14v5c0 1.5 2.2 2.7 5 2.7s5-1.2 5-2.7v-5",
  /* operations */
  OPS_FAILOVER: "M20 12a8 8 0 11-2.4-5.7 M20 4v4h-4",
  OPS_SCALE:    "M4 20v-4 M10 20v-8 M16 20v-12 M3 20h18 M19 4l2 2-2 2",
  OPS_SHED:     "M3 4.5h18l-7 8.2v6.8l-4 2v-8.8z M18 15l3 3 M21 15l-3 3",
  /* interface */
  TELEGRAPH: "M12 3l10 18H2z M12 10v5 M12 18v.2",
  TIMER:     "M12 22a8.5 8.5 0 100-17 8.5 8.5 0 000 17z M12 9v4l2.5 2 M9 2h6",
  LOCK:      "M5 11h14v10H5z M8 11V8a4 4 0 118 0v3",
  CHECK:     "M4 12.5l5 5L20 6.5",
  SCAN:      "M3 7V4h3 M21 7V4h-3 M3 17v3h3 M21 17v3h-3 M4 12h16",
  HEART:     "M12 21s-8-5.5-8-11a4.5 4.5 0 018-2.8A4.5 4.5 0 0120 10c0 5.5-8 11-8 11z",
  BULB:      "M9 18h6 M10 21h4 M12 3a6 6 0 00-3.5 10.9c.6.5 1 1.1 1 1.9v.2h5v-.2c0-.8.4-1.4 1-1.9A6 6 0 0012 3z",
  BOOK:      "M4 4.5A2.5 2.5 0 016.5 2H20v17H6.5A2.5 2.5 0 004 21.5z M4 19.5V4.5 M8 7h8",
  TROPHY:    "M8 4h8v6a4 4 0 01-8 0z M8 6H4v2a3 3 0 003 3 M16 6h4v2a3 3 0 01-3 3 M12 14v4 M8 21h8 M9 18h6",
  USERS:     "M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7z M2.5 20a6.5 6.5 0 0113 0 M16 4.5a3.5 3.5 0 010 6.5 M18 14.5a6.5 6.5 0 013.5 5.5",
  ROBOT:     "M5 8h14v10H5z M12 8V4 M9 13h.01 M15 13h.01 M9 16h6 M3 12v3 M21 12v3",
  CALENDAR:  "M4 5h16v16H4z M4 10h16 M8 3v4 M16 3v4",
  PLAY:      "M7 4l13 8-13 8z",
  CROSS:     "M5 5l14 14 M19 5L5 19",
  PLUS:      "M12 5v14 M5 12h14",
  LINK:      "M10 14a4.5 4.5 0 006.4 0l3-3a4.5 4.5 0 00-6.4-6.4l-1 1 M14 10a4.5 4.5 0 00-6.4 0l-3 3a4.5 4.5 0 006.4 6.4l1-1",
  TIDY:      "M4 4h4v4H4z M16 4h4v4h-4z M4 16h4v4H4z M16 16h4v4h-4z M12 12h.01",
  HOME:      "M3 11l9-8 9 8 M5 10v10h14V10",
  CHEVRON:   "M6 9l6 6 6-6",
  ARROW:     "M5 12h14 M13 6l6 6-6 6",
  EXTERNAL:  "M7 17L17 7 M8 7h9v9",
  COPY:      "M8 8h11v11H8z M5 16V5h11",
  STAR:      "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z",
  TERMINAL:  "M4 5h16v14H4z M7 10l3 2-3 2 M12 15h5",
  MENU:      "M4 7h16 M4 12h16 M4 17h16",
  PALETTE:   "M12 3a9 9 0 100 18c1.4 0 2-.9 2-1.8 0-1.3-1-1.6-1-2.7 0-1 .8-1.5 1.8-1.5H17a4 4 0 004-4c0-4.4-4-8-9-8z M7.5 11h.01 M10 7.5h.01 M14.5 7.5h.01",
  SPARK:     "M12 3v4 M12 17v4 M3 12h4 M17 12h4 M6 6l2.5 2.5 M15.5 15.5L18 18 M18 6l-2.5 2.5 M8.5 15.5L6 18",
  LAYERS:    "M12 3l9 5-9 5-9-5z M3 13l9 5 9-5 M3 17.5l9 5 9-5",
} as const;

export type IconName = keyof typeof ICON_D;
export const PART_ICONS = ["CLIENT", "LB", "APP", "CACHE", "CDN", "DB", "REPLICA", "QUEUE", "WORKER", "RATELIMIT", "UNKNOWN"] as const;

/** What colour each kind of piece uses (from the role tokens). Canvas reads the resolved hex. */
export const ROLE_COLOR: Record<string, string> = {
  CLIENT: "var(--c-blue)", LB: "var(--c-green)", APP: "var(--c-purple)", CACHE: "var(--c-yellow)", CDN: "var(--c-cyan)", DB: "var(--c-red)",
  REPLICA: "var(--c-orange)", QUEUE: "var(--c-teal)", WORKER: "var(--c-steel)", RATELIMIT: "var(--c-magenta)", UNKNOWN: "var(--c-dim)",
  ATK_SPIKE: "var(--c-cyan)", ATK_FLUSH: "var(--c-yellow)", ATK_KILL: "var(--c-red)", ATK_LAG: "var(--c-purple)", ATK_STORM: "var(--c-magenta)",
  OPS_FAILOVER: "var(--c-green)", OPS_SCALE: "var(--c-blue)", OPS_SHED: "var(--c-orange)",
};
