/**
 * Types de la vue anonymisée (brief §9, §11 ; art. R. 4412-93-2).
 *
 * Destinataires : autres travailleurs et membres du CSE. La loi impose une
 * version « anonymisée » de la liste. L'anonymisation n'est PAS une simple
 * suppression des noms : un secteur à effectif réduit ré-identifie une
 * personne même sans son nom (« le seul salarié de l'atelier X exposé au
 * toluène »). On applique donc un seuil de k-anonymat.
 */

/** Une exposition élémentaire à anonymiser (projection des lignes dashboard). */
export interface ExposureRecord {
  /** Identité de la personne pour le DÉCOMPTE de distincts. Jamais publiée. */
  matricule: string | null;
  nom: string;
  prenom: string;
  codeSecteur: string;
  designation: string;
  // Métadonnées produit : NON personnelles, publiables telles quelles.
  nCas: string | null;
  classifSgh: string | null;
  mentionDanger: string | null;
  /** Degré tel qu'importé (texte brut polymorphe), ou null si non renseigné. */
  degreExposition: string | null;
}

export interface AnonymizationOptions {
  /** Seuil de k-anonymat : effectif minimal d'un groupe publié. Défaut 5. */
  k: number;
}

/** Répartition d'un degré dans un groupe (combien de personnes à ce degré). */
export interface DegreeBucket {
  valeur: string;
  effectif: number;
}

/**
 * Un groupe publié = un couple (secteur, produit) dont l'effectif exposé
 * atteint le seuil k. AUCUNE donnée nominative.
 */
export interface AnonymizedGroup {
  codeSecteur: string;
  designation: string;
  nCas: string | null;
  classifSgh: string | null;
  mentionDanger: string | null;
  /** Nombre de personnes DISTINCTES exposées à ce produit dans ce secteur. */
  effectifExpose: number;
  /**
   * Répartition des degrés, triée par effectif décroissant. Ne contient que
   * les modalités dont l'effectif atteint lui aussi le seuil k — publier
   * « Fort : 1 » dans un groupe de 6 divulguerait l'attribut de santé d'une
   * personne identifiable (fuite d'attribut malgré le k-anonymat du couple).
   */
  degres: DegreeBucket[];
  /** Personnes sans degré renseigné — publié seulement si l'effectif ≥ k, sinon 0. */
  effectifSansDegre: number;
  /**
   * Personnes du groupe dont le degré n'est pas détaillé (modalité d'effectif
   * < k, ou sans-degré sous le seuil), agrégées ici. Transparence sans fuite :
   * on dit COMBIEN de degrés sont masqués, jamais LESQUELS.
   */
  effectifDegreMasque: number;
}

export interface AnonymizedView {
  k: number;
  groups: AnonymizedGroup[];
  /**
   * Transparence (règle UX « no silent caps » + RGPD accountability) : on
   * indique COMBIEN d'expositions ont été masquées parce que leur effectif
   * était sous le seuil — SANS révéler quels secteurs ni quels produits
   * (le révéler ré-identifierait justement les petits effectifs).
   */
  masque: {
    /** Nombre de couples (secteur, produit) masqués. */
    groupes: number;
    /** Nombre d'expositions personne×produit masquées. */
    expositions: number;
  };
}
