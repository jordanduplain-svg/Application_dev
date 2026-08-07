import { applyMappingRules } from "../../domain/mapping/mappingRules.js";
import {
  mapDegreExpositionRows,
  mapPersonnelRows,
  mapRisqueChimiqueRows,
} from "../../domain/mapping/mapRows.js";
import type { MappingConfig, RowAnomaly, SourceRow } from "../../domain/mapping/types.js";
import type { Clock } from "../../ports/Clock.js";
import type { DataSource, TableConfig } from "../../ports/DataSource.js";
import type { ImportJournal } from "../../ports/ImportJournal.js";
import type { ListRepository, UpsertReport, WriteContext } from "../../ports/ListRepository.js";

/**
 * Cas d'usage : importer UNE liste depuis UNE source.
 *
 * Pipeline (brief §3) : connecteur → mapping → upsert SCD2 → journal.
 * Le cas d'usage ne connaît ni Excel ni Prisma — uniquement les ports.
 *
 * Une ligne rejetée au mapping N'EMPÊCHE PAS l'import des lignes valides :
 * l'utilisateur HSE corrige son fichier au fil de l'eau (statut PARTIAL).
 * En revanche une erreur de CONFIG (colonne mappée absente) ou une source
 * illisible fait échouer le run (statut FAILED) sans rien écrire : importer
 * un fichier dont le mapping est faux produirait des données fausses en masse.
 */

export interface ImportCommand {
  mapping: MappingConfig;
  table: TableConfig;
  /** Libellé lisible de la source pour le journal (ex. nom du fichier). */
  sourceLabel: string;
  write: WriteContext;
}

export interface ImportResult {
  runId: string;
  status: "success" | "partial" | "failed";
  rowsRead: number;
  report: UpsertReport;
  anomalies: RowAnomaly[];
}

const EMPTY_REPORT: UpsertReport = { created: 0, updated: 0, unchanged: 0 };

export class ImportListUseCase {
  constructor(
    private readonly repository: ListRepository,
    private readonly journal: ImportJournal,
    private readonly clock: Clock,
  ) {}

  async execute(source: DataSource, command: ImportCommand): Promise<ImportResult> {
    const startedAt = this.clock.now();

    let rows: SourceRow[];
    try {
      const raw = await source.fetchTable(command.table);
      // Étape de transformation déclarative (nettoyage, filtrage, concaténation)
      // appliquée AVANT le mapping. Même fonction pure que l'aperçu/dry-run :
      // ce que l'utilisateur a validé à l'écran est exactement ce qui s'importe.
      rows = applyMappingRules(raw, command.mapping.rules ?? []);
    } catch (err: unknown) {
      // Source illisible : run FAILED journalisé, rien n'est écrit en base.
      const anomaly: RowAnomaly = {
        rowNumber: 1,
        field: null,
        code: "mapped_column_absent",
        message: `Source illisible : ${err instanceof Error ? err.message : String(err)}`,
      };
      return this.record(command, startedAt, "failed", 0, EMPTY_REPORT, [anomaly]);
    }

    // --- Mapping (domaine pur). La fermeture `runUpsert` capture les items
    // avec leur type précis par liste : aucune perte de typage entre le
    // mapper et le repository.
    const { anomalies, runUpsert } = this.prepare(rows, command);

    // Erreur de CONFIG → échec global avant toute écriture.
    if (anomalies.some((a) => a.code === "mapped_column_absent")) {
      return this.record(command, startedAt, "failed", rows.length, EMPTY_REPORT, anomalies);
    }

    const report = await runUpsert();
    const status = anomalies.length === 0 ? "success" : "partial";
    return this.record(command, startedAt, status, rows.length, report, anomalies);
  }

  private prepare(
    rows: SourceRow[],
    command: ImportCommand,
  ): { anomalies: RowAnomaly[]; runUpsert: () => Promise<UpsertReport> } {
    const { mapping, write } = command;
    switch (mapping.listType) {
      case "PERSONNEL": {
        const { items, anomalies } = mapPersonnelRows(rows, mapping);
        return { anomalies, runUpsert: () => this.repository.upsertPersonnel(items, write) };
      }
      case "RISQUES_CHIMIQUES": {
        const { items, anomalies } = mapRisqueChimiqueRows(rows, mapping);
        return {
          anomalies,
          runUpsert: () => this.repository.upsertRisquesChimiques(items, write),
        };
      }
      case "DEGRE_EXPOSITION": {
        const { items, anomalies } = mapDegreExpositionRows(rows, mapping);
        return {
          anomalies,
          runUpsert: () => this.repository.upsertDegresExposition(items, write),
        };
      }
    }
  }

  private async record(
    command: ImportCommand,
    startedAt: Date,
    status: ImportResult["status"],
    rowsRead: number,
    report: UpsertReport,
    anomalies: RowAnomaly[],
  ): Promise<ImportResult> {
    const runId = await this.journal.recordRun(
      {
        listType: command.mapping.listType,
        sourceLabel: command.sourceLabel,
        startedAt,
        finishedAt: this.clock.now(),
        status,
        rowsRead,
        report,
        anomalyCount: anomalies.length,
      },
      anomalies,
    );
    return { runId, status, rowsRead, report, anomalies };
  }
}
