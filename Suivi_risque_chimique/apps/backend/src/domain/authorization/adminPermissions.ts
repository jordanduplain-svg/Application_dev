import type { Role } from "./types.js";

/**
 * Tâches d'administration STRICTE de l'application — réservées à l'ADMIN seul.
 *
 *  - Journal d'accès : il trace QUI a consulté/exporté des données de santé.
 *    C'est une donnée sensible en soi (et un outil de contrôle des autres
 *    rôles, HSE inclus) → ADMIN uniquement.
 *  - Gestion des comptes et des rattachements (rôle, matricule, secteurs d'un
 *    manager) : qui peut voir quoi. Donner ce pouvoir au-delà de l'ADMIN
 *    permettrait une escalade de privilèges.
 */
export function canViewAuditLog(role: Role): boolean {
  return role === "ADMIN";
}

export function canManageUsers(role: Role): boolean {
  return role === "ADMIN";
}
