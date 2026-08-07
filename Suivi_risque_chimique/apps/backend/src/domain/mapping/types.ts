/**
 * Types de la couche de mapping : transformation des lignes brutes d'une
 * source (colonnes nommées par le client) en items canoniques prêts pour
 * l'upsert SCD2.
 */

import type { MappingRule } from "./mappingRules.js";

export type ListType = "PERSONNEL" | "RISQUES_CHIMIQUES" | "DEGRE_EXPOSITION";

/**
 * Configuration de correspondance pour une liste : champ canonique → nom de
 * colonne dans le fichier du client.
 *
 * Exemple : { code_secteur: "Code Atelier", nom: "Nom de famille" }
 *
 * MVP : cette config vit dans un fichier JSON fourni à l'import. Plus tard
 * elle sera stockée en base et éditée via l'UI de correspondance (avec
 * suggestions automatiques — cf. docs/UX-PRINCIPLES.md).
 */
export interface MappingConfig {
  listType: ListType;
  columns: Partial<Record<string, string>>;
  /**
   * Règles de transformation appliquées aux lignes brutes AVANT le mapping
   * (nettoyage, valeurs par défaut, filtrage, concaténation). Ensemble fermé —
   * cf. domain/mapping/mappingRules.ts. Optionnel : un import sans règle se
   * comporte exactement comme avant leur introduction.
   */
  rules?: MappingRule[];
}

/** Une ligne brute telle que renvoyée par un connecteur DataSource. */
export type RawRow = Record<string, unknown>;

/**
 * Ligne brute accompagnée de son numéro DANS LA SOURCE (1 = en-têtes).
 * C'est le connecteur qui le fournit : lui seul sait quelles lignes physiques
 * il a sautées (lignes vides en fin de fichier Excel, par exemple). Sans ça,
 * les anomalies pointeraient des numéros décalés et l'utilisateur chercherait
 * l'erreur au mauvais endroit — contraire à la règle UX n°5.
 */
export interface SourceRow {
  rowNumber: number;
  data: RawRow;
}

/**
 * Anomalie détectée sur UNE ligne pendant le mapping. La ligne fautive est
 * REJETÉE (pas importée) : importer une ligne partiellement fausse fausserait
 * les durées d'exposition (ex. une date de retrait illisible devenue null
 * signifierait « produit encore utilisé » — faux et dangereux).
 *
 * `rowNumber` est le numéro de ligne DANS LE FICHIER SOURCE (1 = en-têtes,
 * 2 = première ligne de données) : c'est ce que l'utilisateur voit dans
 * Excel, donc c'est ce qu'on lui montre pour qu'il corrige vite.
 */
export interface RowAnomaly {
  rowNumber: number;
  field: string | null;
  code: "missing_required_field" | "invalid_date" | "mapped_column_absent";
  message: string;
}

// ---------------------------------------------------------------------
// Items canoniques. `naturalKey` est calculée ici (domaine), jamais en
// infrastructure : c'est une règle métier (identité d'une ligne logique).
// ---------------------------------------------------------------------

export interface PersonnelItem {
  naturalKey: string;
  matricule: string | null;
  nom: string;
  prenom: string;
  fonction: string | null;
  codeSecteur: string;
  dateDebutSecteur: Date;
  dateFinSecteur: Date | null;
  /** ETT de l'intérimaire, ou null pour un salarié de l'entreprise. */
  entrepriseTravailTemporaire: string | null;
}

export interface RisqueChimiqueItem {
  naturalKey: string;
  designation: string;
  nCas: string | null;
  classifSgh: string | null;
  pictogrammes: string | null;
  voiesExposition: string | null;
  mentionDanger: string | null;
  mesuresPrevention: string | null;
  niveauRisque: string | null;
  dateEvaluation: Date | null;
  dateRetrait: Date | null;
  codeSecteur: string;
}

export interface DegreExpositionItem {
  naturalKey: string;
  matricule: string | null;
  nom: string;
  prenom: string;
  codeSecteur: string;
  nomProduit: string;
  degreExposition: string;
}

export type CanonicalItem = PersonnelItem | RisqueChimiqueItem | DegreExpositionItem;

/** Résultat du mapping d'un lot de lignes brutes. */
export interface MappingResult<T extends CanonicalItem> {
  items: T[];
  anomalies: RowAnomaly[];
}
