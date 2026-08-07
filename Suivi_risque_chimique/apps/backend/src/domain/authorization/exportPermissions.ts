import type { ExportType } from "../exports/types.js";
import type { Role } from "./types.js";

/**
 * Qui peut déclencher QUEL export (matrice ADR 0002, section « Exports
 * réglementaires »).
 *
 * - individual      : le travailleur pour SA fiche, + Médecine / HSE / Admin
 *                     (qui peuvent éditer la fiche d'un salarié donné).
 * - cse_anonymized  : HSE / RH / Admin (restitution CSE).
 * - spst_nominative : HSE / Médecine / Admin (transmission au SPST).
 *
 * Le MANAGER consulte à l'écran son périmètre mais n'est pas destinataire
 * réglementaire d'un export — exclu de tous les exports au MVP. RH n'accède
 * qu'à l'anonymisé (pas de chimie nominative — cohérent avec sa vue colonnes).
 */
const MATRIX: Record<ExportType, ReadonlySet<Role>> = {
  individual: new Set<Role>(["COLLABORATEUR", "MEDECINE", "HSE", "ADMIN"]),
  cse_anonymized: new Set<Role>(["HSE", "RH", "ADMIN"]),
  spst_nominative: new Set<Role>(["HSE", "MEDECINE", "ADMIN"]),
};

export function canExport(role: Role, type: ExportType): boolean {
  return MATRIX[type].has(role);
}
