import type { Design } from "./types.js";

/** Stable JSON: object keys sorted, no whitespace. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return "[" + v.map(canonicalJson).join(",") + "]";
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(o[k])).join(",") + "}";
}

/** FNV-1a, two independent 32-bit lanes -> 16 hex chars. Not cryptographic. */
export function hash(s: string): string {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0xdeadbeef;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ (c + i), 0x85ebca6b) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/** Hash of a design's topology + policy. Order-independent. */
export function canonicalDesignHash(d: Design): string {
  const nodes = [...d.nodes].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  const edges = [...d.edges].sort((x, y) =>
    x.from !== y.from ? (x.from < y.from ? -1 : 1) : x.to < y.to ? -1 : x.to > y.to ? 1 : 0);
  return hash(canonicalJson({ nodes, edges, policy: d.policy }));
}
