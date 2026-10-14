import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { NO_CARRY, SIM_VERSION, damage, simulate, validate, type Design, type Mods } from "@sysd/sim";
import { LINKSMASH, RULES_VERSION, RULESET, applyAttack, baseMods, type AttackId } from "@sysd/shared";
import { build, designCost, genomes, type Genome } from "./grammar.js";

const BUDGET = LINKSMASH.budget;
type AttackSet = { name: string; apply: (m: Mods) => Mods };
const ATTACK_SETS: AttackSet[] = [
  { name: "spike", apply: (m) => applyAttack(m, "SPIKE") },
  { name: "flush", apply: (m) => applyAttack(m, "FLUSH") },
  { name: "flush+spike", apply: (m) => applyAttack(applyAttack(m, "FLUSH"), "SPIKE") },
  { name: "kill-db", apply: (m) => applyAttack(m, "KILL", "d") },
  { name: "lag", apply: (m) => applyAttack(m, "LAG" as AttackId) },
  { name: "write-storm", apply: (m) => applyAttack(m, "WRITE_STORM") },
];

interface Row { g: Genome; d: Design; cost: number; dmg: number[]; mean: number; worst: number; idle: number }

const rows: Row[] = [];
const t0 = Date.now();
let sims = 0;
for (const g of genomes()) {
  const d = build(g);
  const cost = designCost(d);
  if (cost > BUDGET) continue;
  if (validate(d, RULESET).some((i) => i.severity === "error")) continue;
  const eval1 = (m: Mods): number => {
    sims++;
    const { result } = simulate({ design: d, ruleset: RULESET, scenario: LINKSMASH, mods: m, carry: NO_CARRY });
    return damage(result, LINKSMASH, RULESET, m.durationSec).total;
  };
  const idle = eval1(baseMods(30));
  const dmg = ATTACK_SETS.map((a) => eval1(a.apply(baseMods(30))));
  rows.push({ g, d, cost, dmg, mean: dmg.reduce((s, x) => s + x, 0) / dmg.length, worst: Math.max(...dmg), idle });
}
const secs = (Date.now() - t0) / 1000;

const pct = (n: number, d: number): string => ((100 * n) / d).toFixed(0) + "%";
const out: string[] = [];
const P = (s = ""): void => { out.push(s); console.log(s); };

P(`# Balance sweep — ${SIM_VERSION} / ${RULES_VERSION}`);
P(`${rows.length} affordable designs (<= $${BUDGET}) x ${ATTACK_SETS.length} attack sets = ${sims} sims in ${secs.toFixed(1)}s`);
P();

// 1. dominance checks
P("## Dominance checks");
const unbeatable = rows.filter((r) => r.worst < 5);
P(`- designs taking <5 damage against EVERY attack (unbeatable): ${unbeatable.length}  ${unbeatable.length ? "!! NERF" : "ok"}`);
ATTACK_SETS.forEach((a, i) => {
  const all = rows.map((r) => r.dmg[i] as number);
  const min = Math.min(...all), max = Math.max(...all), mean = all.reduce((s, x) => s + x, 0) / all.length;
  const deadCard = max < 5, unavoidable = min > 35;
  P(`- ${a.name.padEnd(12)} min ${min.toFixed(1).padStart(5)}  mean ${mean.toFixed(1).padStart(5)}  max ${max.toFixed(1).padStart(5)}  ${deadCard ? "!! DEAD CARD" : unavoidable ? "!! UNAVOIDABLE" : "ok"}`);
});
P(`- healthy designs (0 damage idle): ${pct(rows.filter((r) => r.idle === 0).length, rows.length)}   designs hurt with NO attack: ${pct(rows.filter((r) => r.idle > 0).length, rows.length)}`);
P();

// 2. top-decile composition: is any part an auto-include?
const ranked = [...rows].sort((a, b) => a.mean - b.mean);
const top = ranked.slice(0, Math.max(1, Math.floor(rows.length / 10)));
P(`## Top decile (${top.length} designs, mean damage ${top[0]!.mean.toFixed(1)}..${top[top.length - 1]!.mean.toFixed(1)})`);
const feat: [string, (g: Genome) => boolean][] = [
  ["cache", (g) => g.cache], ["cdn", (g) => g.cdn], ["replica>=1", (g) => g.replicas >= 1], ["replica=2", (g) => g.replicas === 2],
  ["queue+worker", (g) => g.queue], ["limiter", (g) => g.limiter], ["breaker", (g) => g.breaker],
  ["idempotent", (g) => g.idempotent], ["apps>=3", (g) => g.apps >= 3], ["retries>=2", (g) => g.retries >= 2],
];
for (const [name, f] of feat) {
  const inTop = top.filter((r) => f(r.g)).length / top.length, inAll = rows.filter((r) => f(r.g)).length / rows.length;
  const flag = inTop > 0.9 ? "!! AUTO-INCLUDE" : inTop < 0.02 ? "!! DEAD PART" : "";
  P(`- ${name.padEnd(14)} top ${pct(inTop * 100, 100).padStart(4)}   all ${pct(inAll * 100, 100).padStart(4)}   ${flag}`);
}
P();

// 3. diversity: how many distinct "shapes" in the top decile
const shape = (g: Genome): string => `${g.apps}a${g.cache ? "+k" : ""}${g.cdn ? "+n" : ""}${g.replicas ? "+r" + g.replicas : ""}${g.queue ? "+q" : ""}`;
const shapes = new Map<string, number>();
top.forEach((r) => shapes.set(shape(r.g), (shapes.get(shape(r.g)) ?? 0) + 1));
P(`## Diversity: ${shapes.size} distinct shapes in the top decile`);
[...shapes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([k, v]) => P(`- ${k.padEnd(16)} x${v}`));
P();

P("## Ten best designs (mean damage across all attacks)");
ranked.slice(0, 10).forEach((r) => P(`- $${String(r.cost).padEnd(4)} mean ${r.mean.toFixed(1).padStart(5)}  worst ${r.worst.toFixed(1).padStart(5)}  ${shape(r.g)}  breaker=${r.g.breaker} retries=${r.g.retries}`));
P();
P("## Ten worst affordable designs");
ranked.slice(-5).forEach((r) => P(`- $${String(r.cost).padEnd(4)} mean ${r.mean.toFixed(1).padStart(5)}  ${shape(r.g)}  breaker=${r.g.breaker} retries=${r.g.retries}`));

const dir = join(dirname(fileURLToPath(import.meta.url)), "../../../reports", SIM_VERSION);
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "sweep.md"), out.join("\n") + "\n");
