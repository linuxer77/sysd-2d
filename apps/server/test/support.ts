/** Re-exports so the tests read like a client would: only the public face of the match package. */
export { botStep, stateHash, verifyReplay } from "@sysd/match";
export type { BotMemo, BotTier, PlayerView } from "@sysd/match";
import { makeRng } from "@sysd/sim";
export const makeBotRng = makeRng;
