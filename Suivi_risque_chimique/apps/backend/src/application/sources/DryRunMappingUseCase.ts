import { mapByListType } from "../../domain/mapping/mapRows.js";
import { applyMappingRules } from "../../domain/mapping/mappingRules.js";
import type { MappingConfig, RowAnomaly } from "../../domain/mapping/types.js";
import type { ConnectorFactory } from "../../ports/ConnectorFactory.js";
import type { TableConfig } from "../../ports/DataSource.js";

/**
 * Cas d'usage : DRY-RUN du mapping — exécuter le VRAI mapper sur la source,
 * sans rien écrire, pour montrer à l'utilisateur, AVANT d'enregistrer la
 * source, combien de lignes passeraient et combien seraient rejetées (et
 * pourquoi). C'est l'étape « validation » du wizard.
 *
 * On réutilise exactement le même pipeline que l'import réel (règles → mapper),
 * pour que le compte annoncé soit le compte obtenu. Les anomalies sont déjà
 * SANS donnée personnelle (champ + motif + numéro de ligne) — elles peuvent
 * être renvoyées telles quelles.
 */

export interface DryRunCommand {
  connectorType: string;
  table: TableConfig;
  mapping: MappingConfig;
}

export interface DryRunResult {
  rowsRead: number;
  wouldImport: number;
  wouldReject: number;
  anomalies: RowAnomaly[];
  /** true si une colonne mappée est absente : l'import RÉEL échouerait en bloc. */
  configError: boolean;
}

export class DryRunMappingUseCase {
  constructor(private readonly connectors: ConnectorFactory) {}

  async execute(command: DryRunCommand): Promise<DryRunResult> {
    const source = this.connectors.create(command.connectorType);
    const raw = await source.fetchTable(command.table);
    const rows = applyMappingRules(raw, command.mapping.rules ?? []);

    const { items, anomalies } = mapByListType(rows, command.mapping);
    const configError = anomalies.some((a) => a.code === "mapped_column_absent");

    return {
      rowsRead: rows.length,
      // En cas d'erreur de config, l'import réel n'écrit RIEN : on l'affiche
      // comme « 0 importées » pour ne pas laisser croire à un succès partiel.
      wouldImport: configError ? 0 : items.length,
      wouldReject: configError ? rows.length : rows.length - items.length,
      anomalies,
      configError,
    };
  }
}
