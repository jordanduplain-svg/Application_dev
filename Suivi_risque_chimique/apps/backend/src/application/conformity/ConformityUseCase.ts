import { findDepartedWorkers } from "../../domain/conformity/findDepartedWorkers.js";
import { retentionCutoff } from "../../domain/conformity/retention.js";
import { buildDashboardRows } from "../../domain/dashboard/buildDashboardRows.js";
import type { DashboardRow, JoinAnomaly } from "../../domain/dashboard/types.js";
import { normalizeText } from "../../domain/mapping/normalizeText.js";
import type { Clock } from "../../ports/Clock.js";
import type { ListRepository, PurgeReport } from "../../ports/ListRepository.js";
import type { TransmissionRepository } from "../../ports/TransmissionRepository.js";

/**
 * Cas d'usage « Conformité » : agrège l'état de conformité (1.2), expose les
 * anomalies de qualité des données (1.3) et pilote la purge de rétention (1.5).
 * Le RBAC est appliqué aux routes.
 */
export interface ConformitySummary {
  lastTransmission: { at: Date; kind: string } | null;
  /** Travailleurs partis dont l'attestation reste à remettre. */
  departuresPending: number;
  /** Produits CMR distincts (secteur × produit) actuellement présents. */
  cmrProducts: number;
  /** Travailleurs distincts exposés à au moins un CMR. */
  cmrExposedWorkers: number;
  /** Nombre d'anomalies de jointure (qualité des données). */
  joinAnomalies: number;
}

const personKey = (r: DashboardRow): string =>
  r.matricule !== null && r.matricule.trim() !== ""
    ? `m:${normalizeText(r.matricule)}`
    : `np:${normalizeText(r.nom)}|${normalizeText(r.prenom)}`;

export class ConformityUseCase {
  constructor(
    private readonly repository: ListRepository,
    private readonly transmissions: TransmissionRepository,
    private readonly clock: Clock,
  ) {}

  private loadRows(
    tenantId: string,
  ): Promise<{ rows: DashboardRow[]; joinAnomalies: JoinAnomaly[]; personnelCount: number }> {
    return Promise.all([
      this.repository.findCurrentPersonnel(tenantId),
      this.repository.findCurrentRisquesChimiques(tenantId),
      this.repository.findCurrentDegresExposition(tenantId),
    ]).then(([personnel, risques, degres]) => {
      const { rows, joinAnomalies } = buildDashboardRows(personnel, risques, degres, this.clock);
      return { rows, joinAnomalies, personnelCount: personnel.length };
    });
  }

  async getSummary(tenantId: string): Promise<ConformitySummary> {
    const [{ rows, joinAnomalies }, personnel, latest] = await Promise.all([
      this.loadRows(tenantId),
      this.repository.findCurrentPersonnel(tenantId),
      this.transmissions.latest(tenantId),
    ]);
    const cmrRows = rows.filter((r) => r.isCmr);
    const cmrProducts = new Set(
      cmrRows.map((r) => `${normalizeText(r.codeSecteur)}|${normalizeText(r.designation)}`),
    ).size;
    const cmrExposedWorkers = new Set(cmrRows.map(personKey)).size;
    const departuresPending = findDepartedWorkers(personnel, this.clock.now()).length;
    return {
      lastTransmission: latest !== null ? { at: latest.at, kind: latest.kind } : null,
      departuresPending,
      cmrProducts,
      cmrExposedWorkers,
      joinAnomalies: joinAnomalies.length,
    };
  }

  async getDataQuality(tenantId: string): Promise<JoinAnomaly[]> {
    const { joinAnomalies } = await this.loadRows(tenantId);
    return joinAnomalies;
  }

  async purge(
    tenantId: string,
    years: number,
    dryRun: boolean,
  ): Promise<{ cutoff: Date } & PurgeReport> {
    const cutoff = retentionCutoff(this.clock.now(), years);
    const report = await this.repository.purgeClosedBefore(tenantId, cutoff, dryRun);
    return { cutoff, ...report };
  }
}
