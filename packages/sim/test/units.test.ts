import { describe, expect, it } from "vitest";
import { canonicalDesignHash, canonicalJson, hash, makeRng } from "../src/index.js";
import { merge, percentile, scaleTo, total } from "../src/latency.js";

describe("rng", () => {
  it("is deterministic per seed and differs across seeds", () => {
    const a = makeRng(42), b = makeRng(42), c = makeRng(43);
    const xs = Array.from({ length: 20 }, () => a.next());
    expect(Array.from({ length: 20 }, () => b.next())).toEqual(xs);
    expect(Array.from({ length: 20 }, () => c.next())).not.toEqual(xs);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });
  it("int() stays in range", () => {
    const r = makeRng(7);
    for (let i = 0; i < 500; i++) { const v = r.int(6); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(6); }
  });
});

describe("hash", () => {
  it("canonicalJson ignores key order and drops undefined", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: undefined }] })).toBe('{"a":[2,{"d":1}],"b":1}');
  });
  it("design hash is order independent", () => {
    const policy = { readTimeoutMs: 1, writeTimeoutMs: 1, retries: 0, breaker: false, retryBudgetPct: 0, idempotentWrites: true };
    const nodes = [{ id: "a", part: "CLIENT" as const }, { id: "b", part: "APP" as const }];
    const edges = [{ from: "a", to: "b" }];
    expect(canonicalDesignHash({ nodes, edges, policy }))
      .toBe(canonicalDesignHash({ nodes: [...nodes].reverse(), edges, policy }));
  });
  it("hash differs for different input", () => { expect(hash("a")).not.toBe(hash("b")); });
});

describe("latency histogram", () => {
  it("percentile walks the flow-weighted CDF", () => {
    const b = [{ lat: 10, flow: 99 }, { lat: 500, flow: 1 }];
    expect(percentile(b, 0.5)).toBe(10);
    expect(percentile(b, 0.99)).toBe(10);        // a 1% tail does not set p99 at exactly 99%
    expect(percentile(b, 0.995)).toBe(500);
  });
  it("a trickle path does NOT dominate the tail (the old maxLat bug)", () => {
    const b = [{ lat: 10, flow: 10000 }, { lat: 9000, flow: 1 }];
    expect(percentile(b, 0.99)).toBe(10);
  });
  it("merge conserves flow and bounds bucket count", () => {
    const a = Array.from({ length: 80 }, (_, i) => ({ lat: i * 3, flow: 2 }));
    const m = merge(a, [{ lat: 5, flow: 1 }], 16);
    expect(m.length).toBeLessThanOrEqual(16);
    expect(total(m)).toBeCloseTo(161, 9);
  });
  it("scaleTo rescales total flow, preserves shape", () => {
    const s = scaleTo([{ lat: 1, flow: 1 }, { lat: 2, flow: 3 }], 8);
    expect(total(s)).toBeCloseTo(8, 12);
    expect(s[1]!.flow / s[0]!.flow).toBeCloseTo(3, 12);
    expect(scaleTo([], 5)).toEqual([]);
  });
});
