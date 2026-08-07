import { buildAnalytics, type Analytics } from "../../domain/analytics/buildAnalytics.js";
import { buildDashboardRows } from "../../domain/dashboard/buildDashboardRows.js";
import { canonicalFieldCatalog, type CanonicalField } from "../../domain/sources/canonicalFields.js";
import type { Clock } from "../../ports/Clock.js";
import type { ListRepository } from "../../ports/ListRepository.js";

/**
 * Cas d'usage « Analytique » (vue data analyst) : explorateur de modèle (5.1)
 * + agrégations pré-construites (5.2). Lecture seule, NON nominatif. RBAC à la
 * route (HSE / Médecine / Admin — données chimiques).
 */
export interface ModelEntry {
  listType: string;
  rowCount: number;
  columns: CanonicalField[];
}

export interface AnalyticsOverview {
  model: ModelEntry[];
  analytics: Analytics;
}

export class AnalyticsUseCase {
  constructor(
    private readonly repository: ListRepository,
    private readonly clock: Clock,
  ) {}

  async getOverview(tenantId: string): Promise<AnalyticsOverview> {
    const [personnel, risques, degres] = await Promise.all([
      this.repository.findCurrentPersonnel(tenantId),
      this.repository.findCurrentRisquesChimiques(tenantId),
      this.repository.findCurrentDegresExposition(tenantId),
    ]);
    const { rows } = buildDashboardRows(personnel, risques, degres, this.clock);
    const fields = canonicalFieldCatalog();
    return {
      model: [
        { listType: "PERSONNEL", rowCount: personnel.length, columns: fields.PERSONNEL },
        {
          listType: "RISQUES_CHIMIQUES",
          rowCount: risques.length,
          columns: fields.RISQUES_CHIMIQUES,
        },
        { listType: "DEGRE_EXPOSITION", rowCount: degres.length, columns: fields.DEGRE_EXPOSITION },
      ],
      analytics: buildAnalytics(rows),
    };
  }
}
