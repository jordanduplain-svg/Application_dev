import { describe, expect, it } from "vitest";

import type { MappingRule } from "../mapping/mappingRules.js";
import { MAPPING_RULE_KINDS } from "../mapping/mappingRules.js";
import { MappingRuleSchema, type ParsedMappingRule } from "../../shared/sourceValidation.js";

/**
 * Garde-fou : le schéma Zod partagé et le type du domaine décrivent EXACTEMENT
 * les mêmes règles. Toute divergence (une règle ajoutée d'un côté seulement)
 * casse ici — à la compilation pour la forme, au test pour les verbes.
 */

// Conformité de forme, vérifiée par le compilateur : chaque type doit être
// assignable à l'autre. Si les unions divergent, l'une de ces lignes échoue.
const _domainToParsed: ParsedMappingRule = { kind: "trim", column: "x" } satisfies MappingRule;
const _parsedToDomain: MappingRule = { kind: "trim", column: "x" } satisfies ParsedMappingRule;
void _domainToParsed;
void _parsedToDomain;

describe("conformité règles domaine ↔ schéma Zod", () => {
  it("le schéma accepte exactement les verbes déclarés par le domaine", () => {
    const kindsInSchema = MappingRuleSchema.options.map((opt) => opt.shape.kind.value).sort();
    expect(kindsInSchema).toEqual([...MAPPING_RULE_KINDS].sort());
  });

  it("valide un exemple de chaque verbe", () => {
    const samples: MappingRule[] = [
      { kind: "trim", column: "A" },
      { kind: "uppercase", column: "A" },
      { kind: "lowercase", column: "A" },
      { kind: "defaultValue", column: "A", value: "x" },
      { kind: "filterRowWhen", column: "A", equals: "ARCHIVE" },
      { kind: "concat", targetColumn: "K", columns: ["A", "B"], separator: " " },
    ];
    for (const sample of samples) {
      expect(MappingRuleSchema.safeParse(sample).success).toBe(true);
    }
  });

  it("rejette un verbe inconnu", () => {
    expect(MappingRuleSchema.safeParse({ kind: "eval", column: "A" }).success).toBe(false);
  });
});
