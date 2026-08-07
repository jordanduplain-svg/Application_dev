import type { Role } from "./types.js";

/**
 * Gestion des flux d'import = tâche OPÉRATIONNELLE (configuration des sources,
 * déclenchement des réimports). Réservée à l'administration et au HSE, qui
 * pilotent l'alimentation des données. Les autres rôles consultent les
 * données, ils ne gèrent pas le pipeline.
 */
export function canManageFlows(role: Role): boolean {
  return role === "ADMIN" || role === "HSE";
}
