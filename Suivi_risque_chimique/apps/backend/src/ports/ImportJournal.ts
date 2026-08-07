import type { RowAnomaly } from "../domain/mapping/types.js";
import type { ImportRunRecord } from "./ListRepository.js";

/**
 * Port `ImportJournal` — persistance du journal des imports et de leurs
 * anomalies.
 *
 * Pourquoi un journal : règle UX n° 4 (« l'état du système est toujours
 * visible ») et exigence de non-masquage des anomalies (données de santé).
 * L'utilisateur HSE doit pouvoir répondre à « mon import est-il passé, et
 * qu'est-ce qui a été rejeté ? » sans ouvrir un terminal.
 */
/** Une exécution d'import telle que présentée à l'écran « mes imports ». */
export interface ImportRunView {
  id: string;
  listType: string;
  sourceLabel: string;
  status: "success" | "partial" | "failed";
  startedAt: Date;
  finishedAt: Date;
  rowsRead: number;
  created: number;
  updated: number;
  unchanged: number;
  anomalies: { rowNumber: number; field: string | null; code: string; message: string }[];
}

export interface ImportJournal {
  /** Enregistre une exécution d'import et ses anomalies. Retourne l'id du run. */
  recordRun(run: ImportRunRecord, anomalies: RowAnomaly[]): Promise<string>;

  /**
   * Derniers runs d'un tenant (plus récent d'abord), anomalies incluses.
   * `limit` borne la lecture — pas de pagination au MVP (on regarde les
   * derniers imports, pas tout l'historique).
   */
  listRuns(tenantId: string, limit?: number): Promise<ImportRunView[]>;
}
