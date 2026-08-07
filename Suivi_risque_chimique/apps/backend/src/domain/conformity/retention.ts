/**
 * Date limite de conservation. Toute VERSION CLOSE (validTo renseigné) d'une
 * ligne logique antérieure à cette date sort de l'obligation de conservation
 * (40 ans par défaut, art. R. 4412-93-3) et peut être purgée. Les versions
 * ACTIVES ne sont JAMAIS concernées — l'état courant reste intact.
 *
 * Fonction PURE (instant injecté).
 */
export function retentionCutoff(now: Date, years: number): Date {
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years);
  return cutoff;
}
