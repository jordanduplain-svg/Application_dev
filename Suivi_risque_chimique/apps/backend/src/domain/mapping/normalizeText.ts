/**
 * Normalisation de texte pour les RAPPROCHEMENTS (jamais pour l'affichage).
 *
 * Décision de cadrage : le rapprochement `nom_produit` ↔ `designation` (et les
 * clés naturelles) se fait par MATCH EXACT APRÈS NORMALISATION — trim, casse,
 * accents, espaces multiples. Pas de fuzzy matching : sur des données de
 * santé, un faux rapprochement attribuerait une exposition au mauvais produit
 * ou à la mauvaise personne. Mieux vaut une anomalie remontée qu'un match
 * approximatif silencieux.
 *
 * La valeur AFFICHÉE reste toujours la valeur source d'origine ; la forme
 * normalisée ne sert qu'à comparer.
 */
export function normalizeText(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      // Décomposition Unicode : "é" devient "e" + diacritique combinant…
      .normalize("NFD")
      // …puis suppression des diacritiques combinants (U+0300 à U+036F).
      .replace(/[̀-ͯ]/g, "")
      // Espaces multiples (doubles espaces de saisie, tabulations) → un seul.
      .replace(/\s+/g, " ")
  );
}
