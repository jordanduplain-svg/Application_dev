import type { Clock } from "../../ports/Clock.js";
import type { ConnectorFactory } from "../../ports/ConnectorFactory.js";
import type {
  FlowDefinition,
  FlowRepository,
  FlowRunStatus,
  ImportSourceDefinition,
} from "../../ports/FlowRepository.js";
import type { SecretVault } from "../../ports/SecretVault.js";
import { ImportListUseCase } from "../import/ImportListUseCase.js";

/**
 * Cas d'usage : exécuter un flow (brief §10).
 *
 * Au MVP, un flow = « réimporter toutes les sources actives du tenant, puis
 * journaliser ». Chaque source passe par le pipeline d'import existant
 * (connecteur → mapping → upsert SCD2). Le « recalcul du tableau de bord »
 * du brief est IMPLICITE dans cette architecture : le dashboard est calculé à
 * la demande depuis l'état courant, donc le prochain affichage reflète
 * automatiquement les données réimportées — pas de vue matérialisée à
 * rafraîchir.
 *
 * Tolérance aux pannes (brief §10) : si UNE source est indisponible (fichier
 * absent, mapping cassé), son import échoue et est journalisé, mais les autres
 * sources continuent et l'application reste opérationnelle sur les données
 * antérieures. Le statut global du flow est :
 *   - success : toutes les sources importées sans anomalie ;
 *   - partial : au moins une anomalie ou un échec, mais au moins une réussite ;
 *   - failed  : aucune source n'a pu être importée (ou aucune source active).
 */

export interface FlowRunSummary {
  flowId: string;
  status: FlowRunStatus;
  sources: {
    sourceId: string;
    name: string;
    outcome: "success" | "partial" | "failed";
    created: number;
    updated: number;
    unchanged: number;
    anomalies: number;
    error?: string;
  }[];
}

export class RunFlowUseCase {
  constructor(
    private readonly flows: FlowRepository,
    private readonly connectors: ConnectorFactory,
    private readonly importList: ImportListUseCase,
    private readonly clock: Clock,
    private readonly vault: SecretVault,
  ) {}

  async execute(flow: FlowDefinition): Promise<FlowRunSummary> {
    const sources = await this.flows.findEnabledSources(flow.tenantId);
    const results: FlowRunSummary["sources"] = [];

    for (const source of sources) {
      results.push(await this.runSource(source, flow));
    }

    const status = aggregateStatus(results);
    await this.flows.recordFlowRun(flow.id, status, this.clock.now());
    return { flowId: flow.id, status, sources: results };
  }

  private async runSource(
    source: ImportSourceDefinition,
    flow: FlowDefinition,
  ): Promise<FlowRunSummary["sources"][number]> {
    try {
      const connector = this.connectors.create(source.connectorType);
      // Secret éventuel (chaîne de connexion d'un connecteur base de données),
      // injecté au moment de la lecture — jamais stocké dans la config.
      const secret = await this.vault.get(flow.tenantId, source.id);
      const result = await this.importList.execute(connector, {
        mapping: source.mapping,
        table: {
          location: source.location,
          ...(source.table !== null ? { table: source.table } : {}),
          ...(secret !== null ? { secret } : {}),
        },
        sourceLabel: `flow:${flow.name}#${source.name}`,
        write: { tenantId: flow.tenantId, recordedBy: `flow:${flow.id}` },
      });
      return {
        sourceId: source.id,
        name: source.name,
        outcome: result.status,
        created: result.report.created,
        updated: result.report.updated,
        unchanged: result.report.unchanged,
        anomalies: result.anomalies.length,
      };
    } catch (err: unknown) {
      // Un connecteur qui lève (type inconnu, I/O) ne fait PAS tomber le flow :
      // on isole l'échec de cette source et on continue les autres.
      return {
        sourceId: source.id,
        name: source.name,
        outcome: "failed",
        created: 0,
        updated: 0,
        unchanged: 0,
        anomalies: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

function aggregateStatus(sources: FlowRunSummary["sources"]): FlowRunStatus {
  if (sources.length === 0) return "failed";
  const anySuccess = sources.some((s) => s.outcome === "success");
  const allClean = sources.every((s) => s.outcome === "success");
  if (allClean) return "success";
  if (anySuccess || sources.some((s) => s.outcome === "partial")) return "partial";
  return "failed";
}
