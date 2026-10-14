import { PARTS } from "@sysd/shared";
import type { AttackId } from "@sysd/shared";
import { ARCHETYPES, cost } from "./archetypes.js";
import { run } from "./run.js";

const scenarios: (AttackId | { id: AttackId; target: string })[][] = [
  [], ["SPIKE"], ["FLUSH"], ["FLUSH", "SPIKE"], [{ id: "KILL", target: "d" }], ["LAG"], ["WRITE_STORM"], ["LAG", "SPIKE"],
];
const pad = (s: string, n: number): string => s.padEnd(n);
console.log(pad("archetype", 14), pad("$", 5), scenarios.map((s) => pad(s.map((x) => (typeof x === "string" ? x : x.id)).join("+") || "none", 13)).join(""));
for (const [name, d] of Object.entries(ARCHETYPES)) {
  const cells = scenarios.map((s) => { const r = run(d, s); return pad(`${r.damage.toFixed(1)}/${r.p99.toFixed(0)}ms`, 13); });
  console.log(pad(name, 14), pad(String(cost(d, PARTS)), 5), cells.join(""));
}
