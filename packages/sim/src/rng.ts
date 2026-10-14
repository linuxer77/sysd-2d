/**
 * xoshiro128** — seeded, no global state. The sim itself never constructs one:
 * a seed arrives from the caller (derived from matchSeed + round + seat), and
 * tie-breaks inside the sim resolve by node id, never by RNG. Used by the bot
 * and balance harness.
 */
export interface Rng {
  next(): number;              // [0, 1)
  int(n: number): number;      // [0, n)
  pick<T>(xs: readonly T[]): T;
}

export function makeRng(seed: number): Rng {
  // splitmix32 to expand one seed into four state words
  let x = seed >>> 0;
  const sm = (): number => {
    x = (x + 0x9e3779b9) >>> 0;
    let z = x;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
  let s0 = sm(), s1 = sm(), s2 = sm(), s3 = sm();
  const rotl = (v: number, k: number): number => ((v << k) | (v >>> (32 - k))) >>> 0;
  const u32 = (): number => {
    const r = Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (s1 << 9) >>> 0;
    s2 ^= s0; s3 ^= s1; s1 ^= s2; s0 ^= s3;
    s2 ^= t; s3 = rotl(s3, 11);
    s0 >>>= 0; s1 >>>= 0; s2 >>>= 0; s3 >>>= 0;
    return r;
  };
  return {
    next: () => u32() / 4294967296,
    int: (n) => Math.floor((u32() / 4294967296) * n),
    pick: (xs) => xs[Math.floor((u32() / 4294967296) * xs.length)] as never,
  };
}
