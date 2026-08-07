import type { AccessScope, AuthenticatedUser } from "./types.js";

/**
 * Construit la portée d'accès d'un utilisateur — traduction exécutable de la
 * matrice ADR 0002 (validée 2026-06-11). UNE seule source de vérité pour les
 * droits : toute lecture du tableau de bord passe par ici.
 *
 * | Rôle          | Lignes               | Colonnes        | Anomalies |
 * |---------------|----------------------|-----------------|-----------|
 * | ADMIN         | toutes               | full            | oui       |
 * | HSE           | toutes               | full            | oui       |
 * | MEDECINE      | toutes (R.4412-93-3) | full            | non       |
 * | RH            | toutes               | administrative  | non       |
 * | MANAGER       | ses secteurs         | full            | non       |
 * | COLLABORATEUR | sa fiche (matricule) | full            | non       |
 */
export function buildAccessScope(user: AuthenticatedUser): AccessScope {
  switch (user.role) {
    case "ADMIN":
      return { rows: { kind: "all" }, columns: "full", seesJoinAnomalies: true };

    case "HSE":
      return { rows: { kind: "all" }, columns: "full", seesJoinAnomalies: true };

    case "MEDECINE":
      // Le médecin du travail conserve IMPÉRATIVEMENT le nominatif complet
      // (suivi médical individuel, art. R. 4412-93-3) — jamais anonymisé.
      return { rows: { kind: "all" }, columns: "full", seesJoinAnomalies: false };

    case "RH":
      // Minimisation : l'administratif (qui, où, quand) sans le bloc
      // chimique (produits, degrés, durées) — choix validé au cadrage.
      return { rows: { kind: "all" }, columns: "administrative", seesJoinAnomalies: false };

    case "MANAGER": {
      if (user.managedSectors.length === 0) {
        // Un manager sans secteur rattaché ne voit RIEN (sécurité par
        // défaut), plutôt que tout voir par configuration manquante.
        return {
          rows: { kind: "none", reason: "manager_sans_secteur" },
          columns: "full",
          seesJoinAnomalies: false,
        };
      }
      return {
        rows: { kind: "sectors", sectors: user.managedSectors },
        columns: "full",
        seesJoinAnomalies: false,
      };
    }

    case "COLLABORATEUR": {
      if (user.matricule === null || user.matricule.trim() === "") {
        return {
          rows: { kind: "none", reason: "collaborateur_sans_matricule" },
          columns: "full",
          seesJoinAnomalies: false,
        };
      }
      return {
        rows: { kind: "self", matricule: user.matricule },
        columns: "full",
        seesJoinAnomalies: false,
      };
    }
  }
}
