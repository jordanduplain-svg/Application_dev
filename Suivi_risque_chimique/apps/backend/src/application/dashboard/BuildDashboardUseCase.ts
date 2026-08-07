import { buildDashboardRows } from "../../domain/dashboard/buildDashboardRows.js";
import type { DashboardData } from "../../domain/dashboard/types.js";
import type { Clock } from "../../ports/Clock.js";
import type { ListRepository } from "../../ports/ListRepository.js";

/**
 * Cas d'usage : construire les données du tableau de bord.
 *
 * MVP étape 4 : périmètre = tout le tenant. L'étape 5 (RBAC) introduira
 * l'`AccessFilter` construit depuis l'utilisateur connecté — il restreindra
 * les listes récupérées ICI, côté serveur, AVANT la jointure : le filtrage
 * par rôle ne sera jamais un post-traitement cosmétique.
 */
export class BuildDashboardUseCase {
  constructor(
    private readonly repository: ListRepository,
    private readonly clock: Clock,
  ) {}

  async execute(tenantId: string): Promise<DashboardData> {
    // Les trois lectures sont indépendantes : on les lance en parallèle.
    const [personnel, risques, degres] = await Promise.all([
      this.repository.findCurrentPersonnel(tenantId),
      this.repository.findCurrentRisquesChimiques(tenantId),
      this.repository.findCurrentDegresExposition(tenantId),
    ]);

    return buildDashboardRows(personnel, risques, degres, this.clock);
  }
}
