/**
 * Formatage déterministe pour les exports. On évite `toLocaleDateString` :
 * un document réglementaire doit être identique quelle que soit la machine
 * (locale système, version d'ICU). Tout passe par ces helpers.
 */

/** Date au format français JJ/MM/AAAA, ou tiret si absente. */
export function formatDateFr(date: Date | null): string {
  if (date === null) return "—";
  const d = String(date.getUTCDate()).padStart(2, "0");
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const y = date.getUTCFullYear();
  return `${d}/${m}/${y}`;
}

/** Durée en années avec une décimale, virgule française. */
export function formatDureeAnnees(annees: number): string {
  if (annees < 0.1) return "< 0,1 an";
  return `${annees.toFixed(1).replace(".", ",")} ans`;
}

/** Valeur texte ou tiret si vide/null. */
export function orDash(value: string | null): string {
  return value === null || value.trim() === "" ? "—" : value;
}
