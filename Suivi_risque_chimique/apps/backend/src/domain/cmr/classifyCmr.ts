/**
 * Détection des agents CMR catégorie 1A/1B à partir de la classification
 * SGH/CLP — le périmètre exact du décret 2024-307.
 *
 * On se fie aux MENTIONS DE DANGER (codes H), seule source faisant foi :
 *   - H350, H350i  → Cancérogène 1A/1B
 *   - H340         → Mutagène 1A/1B
 *   - H360, H360F, H360D, H360FD, H360Fd, H360Df → Toxique pour la reproduction 1A/1B
 *
 * Les catégories 2 (« suspecté » : H351 / H341 / H361*) sont VOLONTAIREMENT
 * EXCLUES : elles ne relèvent pas de l'obligation 1A/1B. On ne déduit jamais le
 * caractère CMR d'un texte libre (« cancérogène » en toutes lettres) — trop de
 * faux positifs (« non cancérogène »…) ; seuls les codes H tranchent.
 *
 * Fonction PURE : sert au tableau de bord, aux exports et au futur écran de
 * conformité (« quels produits CMR ne sont pas déclarés ? »).
 */
export type CmrCategory = "cancérogène" | "mutagène" | "reprotoxique";

export interface CmrClassification {
  isCmr: boolean;
  categories: CmrCategory[];
}

// Ordre C-M-R volontaire (déterminisme + lisibilité).
const RULES: { re: RegExp; category: CmrCategory }[] = [
  { re: /\bH350i?\b/i, category: "cancérogène" },
  { re: /\bH340\b/i, category: "mutagène" },
  { re: /\bH360[A-Za-z]*\b/i, category: "reprotoxique" },
];

export function classifyCmr(...texts: (string | null | undefined)[]): CmrClassification {
  const haystack = texts.filter((t): t is string => Boolean(t)).join(" ");
  const categories: CmrCategory[] = [];
  for (const { re, category } of RULES) {
    if (re.test(haystack)) categories.push(category);
  }
  return { isCmr: categories.length > 0, categories };
}
