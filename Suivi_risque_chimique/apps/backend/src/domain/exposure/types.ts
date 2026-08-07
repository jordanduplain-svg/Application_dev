/**
 * Types du calcul de durée d'exposition.
 *
 * Logique métier (cf. brief section 8) : pour une personne donnée sur un produit
 * donné dans son secteur, la durée d'exposition court de l'entrée dans le
 * secteur jusqu'à la PREMIÈRE des dates de fin connues (départ du secteur OU
 * retrait du produit). Si aucune n'est connue, on considère que l'exposition est
 * en cours et la fin effective est l'instant courant.
 */

/** Données d'entrée du calcul, telles que reçues du repository (canoniques). */
export interface ExposureContext {
  /** Date d'entrée de la personne dans le secteur. Obligatoire. */
  sectorStartDate: Date;
  /**
   * Date de sortie de la personne du secteur, ou `null` si encore en poste dans
   * ce secteur. Une personne peut très bien être encore en poste ailleurs.
   */
  sectorEndDate: Date | null;
  /**
   * Date de retrait du produit (ex. produit substitué, plus utilisé), ou `null`
   * si le produit est toujours utilisé dans le secteur.
   */
  productWithdrawalDate: Date | null;
}

/**
 * Code machine d'une anomalie détectée dans les données d'entrée.
 *
 * Pourquoi un code stable plutôt qu'un message libre : ces anomalies seront
 * journalisées en base (table `import_anomalies` à venir), comptées dans le
 * tableau de bord HSE et exposées dans l'UI ("badge anomalie sur la ligne").
 * Le message peut évoluer (i18n, reformulation) — le code, lui, est l'identité
 * machine de l'anomalie.
 */
export type ExposureAnomalyCode =
  /**
   * La date de fin de secteur est ANTÉRIEURE à la date de début de secteur.
   * Données RH incohérentes — la personne ne peut pas sortir avant d'entrer.
   */
  | "sector_end_before_start"
  /**
   * La date de retrait du produit est ANTÉRIEURE à la date d'entrée de la
   * personne dans le secteur. La personne n'a donc jamais pu être exposée à ce
   * produit dans ce secteur. Données HSE/RH à recroiser.
   */
  | "product_withdrawal_before_sector_start";

export interface ExposureAnomaly {
  code: ExposureAnomalyCode;
  /**
   * Message humain en français, à fins d'affichage HSE. Stable mais traduit/
   * reformulable. Ne pas s'appuyer dessus en code — utiliser `code`.
   */
  message: string;
}

/** Résultat du calcul. */
export interface ExposureDuration {
  /**
   * Durée d'exposition en années (365.25 j/an, suivant la convention julienne
   * standard pour les calculs d'âge/durée moyens). Toujours >= 0.
   *
   * Pourquoi 365.25 : cohérent avec la moyenne sur 4 ans (3×365 + 1×366),
   * pratique pour des bilans HSE pluri-annuels. Si une organisation préfère
   * une autre convention (jours réels), elle pourra dériver depuis cette base.
   */
  years: number;
  /**
   * Anomalies détectées dans les données d'entrée. Tableau vide si aucune.
   *
   * Règle critique pour des données de santé : on ne MASQUE JAMAIS silencieusement
   * une incohérence. Si une anomalie est présente, `years` est forcé à 0 et la
   * couche appelante DOIT remonter l'anomalie (audit, badge UI, table
   * d'anomalies). Cela évite qu'une donnée corrompue produise un chiffre
   * d'exposition trompeur.
   */
  anomalies: ExposureAnomaly[];
}
