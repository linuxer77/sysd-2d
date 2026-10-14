/** Elo. (The plan said Glicko-2; Elo is the honest minimum until there are enough players to need rating uncertainty.) */
export const START_RATING = 1200;
const K = 32;

export function expectedScore(ra: number, rb: number): number {
  return 1 / (1 + Math.pow(10, (rb - ra) / 400));
}

/** score is 1 for a win, 0.5 for a draw, 0 for a loss, from A's side. Returns each player's change. */
export function eloChange(ra: number, rb: number, score: number): { a: number; b: number } {
  const delta = Math.round(K * (score - expectedScore(ra, rb)));
  return { a: delta, b: -delta };
}
