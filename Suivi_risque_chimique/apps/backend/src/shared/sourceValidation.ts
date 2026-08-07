import { z } from "zod";

/**
 * Schémas Zod partagés pour la configuration des sources d'import.
 *
 * Placés dans `shared` car ils sont utilisés par PLUSIEURS couches : la façade
 * HTTP (valider l'entrée du wizard), l'adaptateur Prisma (valider le JSON
 * relu en base), et les cas d'usage. La règle de frontières autorise `shared`
 * depuis partout — c'est le seul endroit neutre où mutualiser sans violer la
 * direction des dépendances.
 *
 * La forme de `MappingRuleSchema` doit rester STRUCTURELLEMENT identique au
 * type `MappingRule` du domaine (domain/mapping/mappingRules.ts). Un test de
 * conformité (domain/sources) verrouille cette équivalence à la compilation.
 */

export const ListTypeSchema = z.enum([
  "PERSONNEL",
  "RISQUES_CHIMIQUES",
  "DEGRE_EXPOSITION",
]);

/** Ensemble FERMÉ de règles — cf. domain/mapping/mappingRules.ts. */
export const MappingRuleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("trim"), column: z.string().min(1) }),
  z.object({ kind: z.literal("uppercase"), column: z.string().min(1) }),
  z.object({ kind: z.literal("lowercase"), column: z.string().min(1) }),
  z.object({ kind: z.literal("defaultValue"), column: z.string().min(1), value: z.string() }),
  z.object({ kind: z.literal("filterRowWhen"), column: z.string().min(1), equals: z.string() }),
  z.object({
    kind: z.literal("concat"),
    targetColumn: z.string().min(1),
    columns: z.array(z.string().min(1)).min(1),
    separator: z.string(),
  }),
  z.object({ kind: z.literal("rename"), column: z.string().min(1), to: z.string().min(1) }),
  z.object({
    kind: z.literal("splitColumn"),
    column: z.string().min(1),
    separator: z.string().min(1),
    left: z.string(),
    right: z.string(),
  }),
  z.object({
    kind: z.literal("replace"),
    column: z.string().min(1),
    search: z.string().min(1),
    replaceWith: z.string(),
  }),
  z.object({ kind: z.literal("removeColumn"), column: z.string().min(1) }),
  z.object({ kind: z.literal("fillDown"), column: z.string().min(1) }),
  z.object({ kind: z.literal("dropEmptyRows") }),
]);

/** Correspondance champ canonique → nom de colonne source. */
export const MappingColumnsSchema = z.record(z.string());

/** Bloc de mapping persisté/transmis : colonnes + règles optionnelles. */
export const MappingShapeSchema = z.object({
  columns: MappingColumnsSchema,
  rules: z.array(MappingRuleSchema).optional(),
});

/**
 * Config propre au connecteur. Au MVP (fichiers) : chemin + feuille éventuelle.
 * AUCUN secret ici — les identifiants des connecteurs distants iront dans un
 * coffre chiffré séparé.
 */
export const ConnectorConfigSchema = z.object({
  location: z.string().min(1),
  sheet: z.string().optional(),
});

export type ParsedMappingRule = z.infer<typeof MappingRuleSchema>;
export type ParsedMappingShape = z.infer<typeof MappingShapeSchema>;
export type ParsedConnectorConfig = z.infer<typeof ConnectorConfigSchema>;
