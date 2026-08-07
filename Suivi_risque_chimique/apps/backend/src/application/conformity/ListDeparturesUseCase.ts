import {
  findDepartedWorkers,
  type DepartedWorker,
} from "../../domain/conformity/findDepartedWorkers.js";
import type { Clock } from "../../ports/Clock.js";
import type { ListRepository } from "../../ports/ListRepository.js";

/**
 * Cas d'usage : lister les travailleurs partis (toutes affectations terminées),
 * pour rappeler la remise de l'attestation individuelle (décret 2024-307).
 * Le RBAC (HSE / Médecine / Admin) est appliqué à la route.
 */
export class ListDeparturesUseCase {
  constructor(
    private readonly repository: ListRepository,
    private readonly clock: Clock,
  ) {}

  async execute(tenantId: string): Promise<DepartedWorker[]> {
    const personnel = await this.repository.findCurrentPersonnel(tenantId);
    return findDepartedWorkers(personnel, this.clock.now());
  }
}
