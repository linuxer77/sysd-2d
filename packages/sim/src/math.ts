/**
 * The ONLY numeric helpers the engine uses. IEEE-754 pins + - * / and sqrt
 * exactly across platforms; it does NOT pin pow/exp/log/trig. Build every curve
 * from * and / so client and server agree bit-for-bit.
 */
export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
export const safeDiv = (a: number, b: number): number => (b === 0 ? 0 : a / b);
/** quantise to 6 decimals so a future refactor reordering a sum by 1 ULP can't change a hash */
export const q6 = (x: number): number => Math.round(x * 1e6) / 1e6;
