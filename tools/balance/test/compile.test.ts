import { describe, expect, it } from "vitest";
import { compile, validate } from "@sysd/sim";
import { RULESET } from "@sysd/shared";
import { ARCHETYPES, design } from "../src/archetypes.js";

const codes = (d: Parameters<typeof compile>[0]) => compile(d, RULESET).issues.map((i) => i.code);

describe("compile / validate", () => {
  it("every archetype compiles clean (no errors)", () => {
    for (const [name, d] of Object.entries(ARCHETYPES)) {
      const c = compile(d, RULESET);
      expect(c.ok, `${name}: ${JSON.stringify(c.issues)}`).toBe(true);
    }
  });

  it("topological order puts every parent before its child", () => {
    const c = compile(ARCHETYPES.layered!, RULESET);
    const rank = new Map(c.nodes.map((n) => [n.id, n.rank]));
    for (const [from, outs] of c.out) for (const e of outs) expect(rank.get(from)!).toBeLessThan(rank.get(e.to)!);
  });

  it("rejects cycles", () => {
    const d = design({ nodes: [["c", "CLIENT"], ["a", "APP"], ["b", "APP"]],
      edges: [["c", "a"], ["a", "b"], ["b", "a"]] });
    expect(codes(d)).toContain("cycle");
  });

  it("rejects self edges, duplicate edges, dangling edges, duplicate ids", () => {
    expect(codes(design({ nodes: [["c", "CLIENT"], ["a", "APP"]], edges: [["a", "a"]] }))).toContain("self-edge");
    expect(codes(design({ nodes: [["c", "CLIENT"], ["a", "APP"]], edges: [["c", "a"], ["c", "a"]] }))).toContain("dup-edge");
    expect(codes(design({ nodes: [["c", "CLIENT"]], edges: [["c", "zz"]] }))).toContain("dangling-edge");
    expect(codes(design({ nodes: [["c", "CLIENT"], ["c", "APP"]], edges: [] }))).toContain("dup-id");
  });

  it("needs exactly one CLIENT", () => {
    expect(codes(design({ nodes: [["a", "APP"]], edges: [] }))).toContain("client-count");
    expect(codes(design({ nodes: [["c", "CLIENT"], ["d", "CLIENT"]], edges: [] }))).toContain("client-count");
  });

  it("rejects integer-like and malformed ids (JS key-order hazard)", () => {
    expect(codes(design({ nodes: [["c", "CLIENT"], ["12", "APP"]], edges: [] }))).toContain("bad-id");
    expect(codes(design({ nodes: [["c", "CLIENT"], ["Bad Id", "APP"]], edges: [] }))).toContain("bad-id");
  });

  it("types edges by capability: a cache cannot accept writes", () => {
    const c = compile(ARCHETYPES.cached!, RULESET);
    const ak = c.out.get("a1")!.find((e) => e.to === "k")!;
    expect(ak.carries).toEqual({ read: true, write: false, repl: false });
    const ad = c.out.get("a1")!.find((e) => e.to === "d")!;
    expect(ad.carries).toEqual({ read: true, write: true, repl: false });
  });

  it("DB -> REPLICA resolves to a replication edge automatically", () => {
    const c = compile(ARCHETYPES.replicated!, RULESET);
    expect(c.repl.get("d")).toEqual(["r1", "r2"]);
  });

  it("warns (not errors) on structural smells", () => {
    expect(codes(design({ nodes: [["c", "CLIENT"], ["r", "REPLICA"]], edges: [["c", "r"]] }))).toContain("replica-no-primary");
    expect(codes(design({ nodes: [["c", "CLIENT"], ["q", "QUEUE"]], edges: [["c", "q"]] }))).toContain("queue-no-worker");
    expect(codes(design({ nodes: [["c", "CLIENT"], ["k", "CACHE"]], edges: [["c", "k"]] }))).toContain("cache-no-origin");
    expect(codes(design({ nodes: [["c", "CLIENT"], ["d", "DB"], ["e", "DB"]], edges: [["c", "d"], ["d", "e"]] }))).toContain("dead-link");
  });

  it("validates policy ranges and budget", () => {
    const bad = design({ nodes: [["c", "CLIENT"]], edges: [], policy: { retries: 9 } });
    expect(codes(bad)).toContain("bad-policy");
    const issues = validate(ARCHETYPES.layered!, RULESET, { budget: 100 });
    expect(issues.some((i) => i.code === "over-budget")).toBe(true);
  });

  it("is invariant to input ordering", () => {
    const d = ARCHETYPES.layered!;
    const shuffled = { ...d, nodes: [...d.nodes].reverse(), edges: [...d.edges].reverse() };
    expect(compile(shuffled, RULESET).nodes.map((n) => n.id)).toEqual(compile(d, RULESET).nodes.map((n) => n.id));
  });
});
