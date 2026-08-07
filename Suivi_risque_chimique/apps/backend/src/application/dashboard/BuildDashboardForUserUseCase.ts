import { buildAccessScope } from "../../domain/authorization/buildAccessScope.js";
import { AccessDeniedError } from "../../domain/authorization/errors.js";
import {
  toAdministrativeRows,
  type DashboardView,
} from "../../domain/authorization/projectDashboard.js";
import type { AuthenticatedUser } from "../../domain/authorization/types.js";
import { buildDashboardRows } from "../../domain/dashboard/buildDashboardRows.js";
import { normalizeText } from "../../domain/mapping/normalizeText.js";
import type { Clock } from "../../ports/Clock.js";
import type { ListRepository } from "../../ports/ListRepository.js";

/**
 * Cas d'usage : tableau de bord POUR UN UTILISATEUR — le RBAC est appliqué
 * ici, côté serveur, AVANT toute sérialisation (brief §11/§18, ADR 0002).
 *
 * Le row-level descend dans la requête SQL (port `CurrentFilter`). La
 * projection colonnes choisit ce qui est sérialisé. Le navigateur ne reçoit
 * JAMAIS une donnée hors périmètre.
 */
export class BuildDashboardForUserUseCase {
  constructor(
    private readonly repository: ListRepository,
    private readonly clock: Clock,
  ) {}

  async execute(user: AuthenticatedUser, asOf?: Date): Promise<DashboardView> {
    const scope = buildAccessScope(user);
    const { tenantId } = user;

    if (scope.rows.kind === "none") {
      throw new AccessDeniedError(scope.rows.reason);
    }

    // En vue temporelle, l'instant « courant » devient la date consultée : une
    // exposition en cours à cette date compte sa durée jusqu'à ELLE, pas
    // jusqu'à aujourd'hui. Sinon, horloge réelle.
    const effectiveClock: Clock = asOf !== undefined ? { now: () => asOf } : this.clock;

    // --- Vue administrative (RH) : seul le PERSONNEL est chargé. Les listes
    // chimiques ne sont même pas lues — minimisation dès la requête.
    if (scope.columns === "administrative") {
      const personnel = await this.repository.findCurrentPersonnel(tenantId, undefined, asOf);
      return { columns: "administrative", rows: toAdministrativeRows(personnel) };
    }

    // --- Vues complètes, par portée de lignes.
    switch (scope.rows.kind) {
      case "all": {
        const [personnel, risques, degres] = await Promise.all([
          this.repository.findCurrentPersonnel(tenantId, undefined, asOf),
          this.repository.findCurrentRisquesChimiques(tenantId, undefined, asOf),
          this.repository.findCurrentDegresExposition(tenantId, undefined, asOf),
        ]);
        const { rows, joinAnomalies } = buildDashboardRows(
          personnel,
          risques,
          degres,
          effectiveClock,
        );
        return {
          columns: "full",
          rows,
          joinAnomalies: scope.seesJoinAnomalies ? joinAnomalies : [],
        };
      }

      case "sectors": {
        const filter = { sectors: scope.rows.sectors };
        const [personnel, risques, degres] = await Promise.all([
          this.repository.findCurrentPersonnel(tenantId, filter, asOf),
          this.repository.findCurrentRisquesChimiques(tenantId, filter, asOf),
          this.repository.findCurrentDegresExposition(tenantId, filter, asOf),
        ]);
        const { rows } = buildDashboardRows(personnel, risques, degres, effectiveClock);
        return { columns: "full", rows, joinAnomalies: [] };
      }

      case "self": {
        const matricule = scope.rows.matricule;

        // 1. Les affectations de la personne déterminent ses secteurs.
        const own = await this.repository.findCurrentPersonnel(tenantId, { matricule }, asOf);
        if (own.length === 0) {
          // Compte rattaché à un matricule absent des données : fiche vide
          // (pas une erreur — la personne n'est peut-être pas encore importée).
          return { columns: "full", rows: [], joinAnomalies: [] };
        }
        const sectors = [...new Set(own.map((p) => p.codeSecteur))];

        // 2. On charge le CONTEXTE COMPLET de ces secteurs (tout le personnel,
        // pas seulement la personne) pour que la jointure garde la même
        // sémantique que la vue HSE — notamment la détection d'homonymes :
        // un degré ambigu reste NON attribué, y compris sur sa propre fiche.
        // Ces données restent en mémoire serveur ; la réponse est filtrée
        // au matricule juste en dessous.
        const sectorFilter = { sectors };
        const [personnel, risques, degres] = await Promise.all([
          this.repository.findCurrentPersonnel(tenantId, sectorFilter, asOf),
          this.repository.findCurrentRisquesChimiques(tenantId, sectorFilter, asOf),
          this.repository.findCurrentDegresExposition(tenantId, sectorFilter, asOf),
        ]);
        const { rows } = buildDashboardRows(personnel, risques, degres, effectiveClock);

        const self = normalizeText(matricule);
        return {
          columns: "full",
          rows: rows.filter((r) => r.matricule !== null && normalizeText(r.matricule) === self),
          joinAnomalies: [],
        };
      }
    }
  }
}
