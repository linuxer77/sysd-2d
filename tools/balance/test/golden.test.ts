import { describe, expect, it } from "vitest";
import { NO_CARRY, canonicalJson, damage, hash, simulate, SIM_VERSION, type Mods } from "@sysd/sim";
import { LINKSMASH, RULESET, applyAttack, baseMods, type AttackId } from "@sysd/shared";
import { ARCHETYPES } from "../src/archetypes.js";

/**
 * Golden corpus. Every snapshot embeds simVersion + rulesetHash, so ANY balance change
 * fails loudly here and shows up as a reviewable diff of exactly which scenarios moved.
 * Update with `pnpm test -u` after bumping SIM_VERSION / RULES_VERSION on purpose.
 */
const SCENARIOS: { name: string; attacks: (AttackId | { id: AttackId; target: string })[] }[] = [
  { name: "none", attacks: [] },
  { name: "spike", attacks: ["SPIKE"] },
  { name: "flush", attacks: ["FLUSH"] },
  { name: "flush+spike", attacks: ["FLUSH", "SPIKE"] },
  { name: "kill-db", attacks: [{ id: "KILL", target: "d" }] },
  { name: "lag", attacks: ["LAG"] },
  { name: "write-storm", attacks: ["WRITE_STORM"] },
];

const rulesetHash = hash(canonicalJson(RULESET));

describe("golden", () => {
  it("pins the ruleset", () => { expect({ SIM_VERSION, rules: RULESET.version, rulesetHash }).toMatchSnapshot(); });

  for (const [name, design] of Object.entries(ARCHETYPES)) {
    for (const sc of SCENARIOS) {
      it(`${name} / ${sc.name}`, () => {
        let mods: Mods = baseMods(30);
        for (const a of sc.attacks) mods = typeof a === "string" ? applyAttack(mods, a) : applyAttack(mods, a.id, a.target);
        const { result, carry } = simulate({ design, ruleset: RULESET, scenario: LINKSMASH, mods, carry: NO_CARRY });
        expect({
          damage: damage(result, LINKSMASH, RULESET, 30),
          read: result.read, write: result.write, consistency: result.consistency,
          nodes: result.nodes.map((n) => [n.id, n.util, n.latMs, n.loadR, n.loadW]),
          findings: result.findings.map((f) => f.code + (f.nodeId ? ":" + f.nodeId : "")),
          carry,
        }).toMatchSnapshot();
      });
    }
  }
});
