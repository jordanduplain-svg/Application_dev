import type { CmrCategory } from "../cmr/classifyCmr.js";
import type { ExposureAnomaly } from "../exposure/types.js";

/**
 * Types du tableau de bord — la restitution centrale de l'app (brief §9).
 * Une ligne = une personne × un produit présent dans son secteur, enrichie du
 * degré d'exposition (si connu) et de la durée calculée.
 */

/** Les 13 colonnes du brief §9, plus les identifiants techniques utiles. */
export interface DashboardRow {
  // Identité (les colonnes 1-5 du brief)
  matricule: string | null;
  nom: string;
  prenom: string;
  fonction: string | null;
  codeSecteur: string;
  dateDebutSecteur: Date;
  dateFinSecteur: Date | null;
  /** ETT de l'intérimaire, ou null pour un salarié de l'entreprise. */
  entrepriseTravailTemporaire: string | null;

  // Produit (colonnes 6-11)
  designation: string;
  nCas: string | null;
  classifSgh: string | null;
  mentionDanger: string | null;
  /** Agent CMR 1A/1B (décret 2024-307), déduit de la classification SGH/CLP. */
  isCmr: boolean;
  /** Catégories CMR détectées (cancérogène / mutagène / reprotoxique). */
  cmrCategories: CmrCategory[];
  dateEvaluation: Date | null;
  dateRetrait: Date | null;

  // Exposition (colonnes 12-13)
  /**
   * Degré d'exposition tel qu'importé (texte brut, polymorphe selon le
   * client), ou null si aucun degré n'a été renseigné pour ce couple
   * (légal : R. 4412-93-1 dit « lorsqu'elles sont connues »).
   */
  degreExposition: string | null;
  dureeExpositionAnnees: number;

  /**
   * Anomalies du calcul de durée pour CETTE ligne (dates incohérentes…).
   * Affichées en badge sur la ligne — jamais masquées.
   */
  exposureAnomalies: ExposureAnomaly[];
}

/**
 * Anomalie de JOINTURE : un problème de cohérence ENTRE les listes, détecté
 * au croisement (et non à l'import d'une liste isolée). Remontées à part des
 * lignes pour alimenter l'écran qualité des données HSE.
 */
export interface JoinAnomaly {
  code:
    /**
     * Un degré d'exposition référence une personne par nom+prénom, mais
     * PLUSIEURS personnes du secteur portent ce nom normalisé. Attribuer au
     * hasard est exclu (données de santé) : le degré n'est PAS attribué et
     * l'anomalie exige un matricule dans la source.
     */
    | "ambiguous_person_match"
    /** Un degré référence un produit introuvable dans les risques du secteur. */
    | "degree_orphan_product"
    /** Un degré référence une personne introuvable dans le secteur. */
    | "degree_orphan_person";
  codeSecteur: string;
  /** Détail technique SANS donnée nominative en clair côté logs. */
  message: string;
  /** Clé naturelle du degré concerné (pour investiguer dans la source). */
  degreNaturalKey: string;
}

export interface DashboardData {
  rows: DashboardRow[];
  joinAnomalies: JoinAnomaly[];
}
