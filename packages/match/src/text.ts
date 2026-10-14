import { ATTACK_INFO, OPERATION_INFO, PART_INFO } from "@sysd/shared";
import type { Category, MatchResult, RoundLog, Seat, SeatRound } from "./types.js";
import { other } from "./types.js";

/** Plain-language narration. Same rules as all player copy: no abbreviations, ever. */

export const CATEGORY_TEXT: Readonly<Record<Category, { title: string; detail: string }>> = {
  load:   { title: "A big crowd is coming", detail: "Far more visitors than usual are about to arrive." },
  cache:  { title: "Your caches are being targeted", detail: "Something is about to empty your caches so every lookup goes to the database." },
  crash:  { title: "A crash is coming", detail: "One of your pieces is about to stop working." },
  slow:   { title: "Things are about to slow down", detail: "Everything that stores data is about to get much slower." },
  writes: { title: "A burst of new links is coming", detail: "Far more people than usual are about to save new links at once." },
};

export const RESULT_REASON_TEXT = {
  health: (youWon: boolean) => youWon ? "You had more health left when the last round ended." : "Your rival had more health left when the last round ended.",
  cheaper: (youWon: boolean) => youWon ? "You finished with the same health, but your design cost less." : "You finished with the same health, but your rival's design cost less.",
  faster: (youWon: boolean) => youWon ? "Health and cost were equal, but your visitors got faster answers." : "Health and cost were equal, but your rival's visitors got faster answers.",
  simpler: (youWon: boolean) => youWon ? "Everything else was equal, but your design used fewer pieces. Simple wins." : "Everything else was equal, but your rival's design used fewer pieces. Simple wins.",
  even: () => "Everything was exactly equal. It is a draw.",
  forfeit: (youWon: boolean) => youWon ? "Your rival left the match." : "You left the match.",
} as const;

export function explainResult(r: MatchResult, you: Seat): { headline: string; why: string } {
  if (r.winner === "draw") return { headline: "It is a draw", why: RESULT_REASON_TEXT.even() };
  const youWon = r.winner === you;
  const why = (RESULT_REASON_TEXT[r.reason] as (w: boolean) => string)(youWon);
  return { headline: youWon ? "You win" : "You lose", why };
}

const nm = (id: string): string => (id in PART_INFO ? PART_INFO[id as keyof typeof PART_INFO].fullName : "a piece");

/** One short sentence per thing that happened, from `you`'s point of view. */
export function describeRound(log: RoundLog, you: Seat): string[] {
  const out: string[] = [];
  const mine = log.seats[you], theirs = log.seats[other(you)];
  const side = (r: SeatRound, own: boolean): void => {
    const who = own ? "You" : "Your rival";
    if (r.ops) out.push(`${who} used ${OPERATION_INFO[r.ops].fullName.toLowerCase()}.`);
    if (r.attack) {
      const name = ATTACK_INFO[r.attack.id].fullName.toLowerCase();
      out.push(r.whiffed ? `${who} tried ${name}, but it missed.` : `${who} used ${name}.`);
    }
    if (r.bluffed) out.push(`${who} bluffed: the warning did not match the attack.`);
  };
  side(mine, true); side(theirs, false);
  const hurt = (r: SeatRound, own: boolean): void => {
    const who = own ? "Your" : "Your rival's";
    if (r.damageTaken <= 0) out.push(`${who} stack took no damage.`);
    else out.push(`${who} stack lost ${r.damageTaken} health.`);
    const top = r.hottest[0];
    if (top && top.util > 1) out.push(`${who} ${top.part === "UNKNOWN" ? "busiest piece" : nm(top.part).toLowerCase()} was ${Math.round(top.util * 100)} percent full.`);
    if (r.amplification > 1.15) out.push(`${who} retries multiplied the traffic by ${r.amplification.toFixed(1)} times.`);
  };
  hurt(mine, true); hurt(theirs, false);
  return out;
}

export const ROUND_LABEL = (round: number, total: number): string => `Round ${round} of ${total}`;
