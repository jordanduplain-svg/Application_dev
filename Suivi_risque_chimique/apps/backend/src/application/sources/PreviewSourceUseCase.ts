import { applyMappingRules, type MappingRule } from "../../domain/mapping/mappingRules.js";
import type { SourceRow } from "../../domain/mapping/types.js";
import { analyzeColumns, type ColumnProfile } from "../../domain/sources/analyzeColumns.js";
import type { ConnectorFactory } from "../../ports/ConnectorFactory.js";
import type { TableConfig } from "../../ports/DataSource.js";

/**
 * Cas d'usage : PRÉVISUALISER une source — lire un échantillon, appliquer les
 * règles de transformation, et profiler les colonnes. Aucune écriture en base,
 * aucun mapping vers les champs canoniques : c'est l'étape « je regarde ce
 * qu'il y a dans le fichier » du wizard, avant même de décider du mapping.
 *
 * Confidentialité : l'échantillon et les profils peuvent contenir des valeurs
 * de cellules (potentiellement des noms). Le résultat est renvoyé à un
 * utilisateur habilité (RBAC en façade) et n'est JAMAIS journalisé.
 */

export interface PreviewCommand {
  connectorType: string;
  table: TableConfig;
  /** Règles à appliquer pour prévisualiser le résultat « après nettoyage ». */
  rules?: MappingRule[];
  /** Nombre de lignes d'échantillon renvoyées (défaut raisonnable). */
  sampleSize?: number;
}

export interface PreviewResult {
  /** Nombre total de lignes de données dans la source (après filtrage). */
  rowCount: number;
  columns: ColumnProfile[];
  /** Échantillon des premières lignes (clé = colonne, valeur = texte affichable). */
  sampleRows: Record<string, string | null>[];
}

const DEFAULT_SAMPLE_ROWS = 20;

export class PreviewSourceUseCase {
  constructor(private readonly connectors: ConnectorFactory) {}

  async execute(command: PreviewCommand): Promise<PreviewResult> {
    const source = this.connectors.create(command.connectorType);
    const raw = await source.fetchTable(command.table);
    const rows = applyMappingRules(raw, command.rules ?? []);

    const analysis = analyzeColumns(rows);
    const limit = command.sampleSize ?? DEFAULT_SAMPLE_ROWS;

    return {
      rowCount: analysis.rowCount,
      columns: analysis.columns,
      sampleRows: rows.slice(0, limit).map((r) => toDisplayRow(r, analysis.columns)),
    };
  }
}

/**
 * Aplati une ligne brute en valeurs texte affichables, en suivant l'ordre des
 * colonnes détectées (pour un rendu de tableau stable). Les Date sont rendues
 * en ISO court ; le reste est stringifié sans interprétation.
 */
function toDisplayRow(
  row: SourceRow,
  columns: ColumnProfile[],
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const col of columns) {
    const v = row.data[col.name];
    out[col.name] =
      v === null || v === undefined
        ? null
        : v instanceof Date
          ? v.toISOString().slice(0, 10)
          : String(v);
  }
  return out;
}
