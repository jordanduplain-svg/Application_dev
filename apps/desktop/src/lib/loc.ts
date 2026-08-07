/** Normalise un libellé de lieu pour comparaison : sans accents, minuscule, séparateurs → espace. */
export function normLoc(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
