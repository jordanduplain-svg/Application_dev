/**
 * Constantes métier partagées entre l'API et l'app mobile.
 */

/**
 * Prix unitaire (en euros) d'une candidature.
 * Source de vérité UNIQUE : utilisée à la fois pour calculer le budget côté
 * API et pour afficher le tarif dans l'app, afin d'éviter toute divergence.
 */
export const PRICE_PER_APPLICATION = 2.0;

/**
 * Version courante des Conditions Générales d'Utilisation.
 * Stockée à l'inscription (`User.tosVersion`) : incrémenter cette valeur
 * permettra, plus tard, de redemander le consentement après une mise à jour
 * des CGU.
 */
export const TOS_VERSION = '2026-05';

/** URLs des documents légaux (affichées sur l'écran d'inscription). */
export const LEGAL_URLS = {
  terms: 'https://candio.app/cgu',
  privacy: 'https://candio.app/confidentialite',
} as const;
