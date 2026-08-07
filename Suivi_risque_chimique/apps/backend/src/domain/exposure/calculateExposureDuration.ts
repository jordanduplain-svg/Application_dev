import type { Clock } from "../../ports/Clock.js";
import type { ExposureAnomaly, ExposureContext, ExposureDuration } from "./types.js";

/** 365.25 jours par an, en millisecondes. Cf. justification dans `types.ts`. */
const MILLISECONDS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

/**
 * Calcule la durée d'exposition d'une personne à un produit dans un secteur.
 *
 * Règle métier (brief §8) :
 *   - on retient comme fin EFFECTIVE la PREMIÈRE date connue parmi
 *     `sectorEndDate` et `productWithdrawalDate`,
 *   - si aucune des deux n'est connue, on utilise l'instant courant
 *     (l'exposition est toujours en cours),
 *   - la durée est `(fin effective - début) / un an`, jamais négative.
 *
 * Pourquoi la PREMIÈRE date et pas la dernière : l'exposition cesse au premier
 * des deux événements. Si la personne quitte le secteur le 1er janvier et que
 * le produit n'est retiré qu'en juin, la personne n'a plus été exposée à partir
 * de janvier. Inversement, si le produit est retiré en mars et que la personne
 * reste, l'exposition à CE produit cesse en mars.
 *
 * Sur les anomalies (brief — choix utilisateur "Durée = 0 + anomalie remontée") :
 *   - on détecte avant le calcul les incohérences manifestes
 *     (date_fin < date_debut, retrait < date_debut),
 *   - en présence d'au moins une anomalie, on FORCE la durée à 0,
 *   - on ne masque JAMAIS silencieusement : la liste `anomalies` est non vide,
 *     l'appelant a la responsabilité de la propager (audit, badge UI, table
 *     `import_anomalies`).
 *
 * Cette fonction est PURE : pas d'I/O, pas de `Date.now()` direct (l'instant
 * courant arrive via le port `Clock`), pas d'effet de bord. Elle est par
 * conséquent rapide et exhaustivement testable.
 */
export function calculateExposureDuration(
  context: ExposureContext,
  clock: Clock,
): ExposureDuration {
  const { sectorStartDate, sectorEndDate, productWithdrawalDate } = context;
  const anomalies: ExposureAnomaly[] = [];

  if (
    sectorEndDate !== null &&
    sectorEndDate.getTime() < sectorStartDate.getTime()
  ) {
    anomalies.push({
      code: "sector_end_before_start",
      message:
        "La date de fin de secteur est antérieure à la date de début. " +
        "Données RH à vérifier.",
    });
  }

  if (
    productWithdrawalDate !== null &&
    productWithdrawalDate.getTime() < sectorStartDate.getTime()
  ) {
    anomalies.push({
      code: "product_withdrawal_before_sector_start",
      message:
        "Le retrait du produit est antérieur à l'entrée de la personne dans " +
        "le secteur : aucune exposition possible. Données HSE/RH à recroiser.",
    });
  }

  // En présence d'une anomalie sur les dates, on ne calcule pas — la durée
  // n'aurait pas de sens. Retour explicite à 0, anomalies remontées.
  if (anomalies.length > 0) {
    return { years: 0, anomalies };
  }

  // Date de fin effective : `min` des dates connues, ou `now` si aucune n'est
  // connue (exposition en cours).
  const knownEndCandidates: Date[] = [];
  if (sectorEndDate !== null) knownEndCandidates.push(sectorEndDate);
  if (productWithdrawalDate !== null) knownEndCandidates.push(productWithdrawalDate);

  const effectiveEnd =
    knownEndCandidates.length === 0
      ? clock.now()
      : new Date(Math.min(...knownEndCandidates.map((d) => d.getTime())));

  const elapsedMs = effectiveEnd.getTime() - sectorStartDate.getTime();

  // `Math.max(0, …)` : sécurité. En théorie, après filtrage des anomalies,
  // `elapsedMs` est >= 0 (les dates connues sont >= début, et l'horloge ne va
  // pas dans le passé). En pratique, garder ce garde-fou évite tout risque de
  // durée négative en cas de Clock fantaisiste injecté par erreur.
  const years = Math.max(0, elapsedMs / MILLISECONDS_PER_YEAR);

  return { years, anomalies };
}
