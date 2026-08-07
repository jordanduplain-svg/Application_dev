import type { ListType } from "../mapping/types.js";

/**
 * Catalogue des champs canoniques par type de liste — SOURCE DE VÉRITÉ unique,
 * partagée entre le mapper (domaine), la validation et l'UI de correspondance.
 *
 * Pourquoi ici, et pas dispersé dans mapRows.ts : l'écran de mapping doit
 * proposer la liste exacte des champs à renseigner, savoir lesquels sont
 * OBLIGATOIRES (un mapping incomplet sur un champ requis fera échouer l'import)
 * et lesquels sont des DATES (pour proposer le format attendu). Dupliquer cette
 * connaissance côté frontend la ferait diverger du comportement réel du mapper.
 * Elle est donc exposée via l'API (`GET /api/sources/schema`).
 *
 * L'ordre des champs est l'ordre d'affichage suggéré dans le wizard.
 */

export type FieldKind = "text" | "date";

export interface CanonicalField {
  /** Identifiant technique du champ (clé attendue dans MappingConfig.columns). */
  field: string;
  /** Libellé lisible (FR) pour l'écran de mapping. */
  label: string;
  /** Un mapping de ce champ est-il indispensable à l'import ? */
  required: boolean;
  kind: FieldKind;
  /** Aide courte affichée sous le champ (le « pourquoi », pas le « quoi »). */
  hint?: string;
}

/**
 * Définitions alignées EXACTEMENT sur les lectures de domain/mapping/mapRows.ts.
 * Toute évolution du mapper doit être répercutée ici (et vice-versa) — c'est le
 * contrat partagé. Les libellés reprennent ceux des colonnes du dashboard
 * (frontend/locales) pour que l'utilisateur retrouve les mêmes mots.
 */
const PERSONNEL_FIELDS: CanonicalField[] = [
  { field: "matricule", label: "Matricule", required: false, kind: "text", hint: "Identité stable ; à défaut, nom + prénom servent de repli." },
  { field: "nom", label: "Nom de famille", required: true, kind: "text" },
  { field: "prenom", label: "Prénom", required: true, kind: "text" },
  { field: "fonction", label: "Fonction", required: false, kind: "text" },
  { field: "code_secteur", label: "Code secteur", required: true, kind: "text", hint: "Clé de jointure avec les risques chimiques." },
  { field: "date_debut_secteur", label: "Entrée dans le secteur", required: true, kind: "date" },
  { field: "date_fin_secteur", label: "Sortie du secteur", required: false, kind: "date", hint: "Vide = encore en poste." },
  { field: "entreprise_tt", label: "Entreprise de travail temporaire", required: false, kind: "text", hint: "Renseigné pour un intérimaire ; vide pour un salarié de l'entreprise." },
];

const RISQUES_FIELDS: CanonicalField[] = [
  { field: "designation", label: "Désignation du produit", required: true, kind: "text" },
  { field: "code_secteur", label: "Code secteur", required: true, kind: "text" },
  { field: "n_cas", label: "N° CAS", required: false, kind: "text" },
  { field: "classif_sgh", label: "Classification SGH/CLP", required: false, kind: "text", hint: "Identifie les CMR 1A/1B." },
  { field: "pictogrammes", label: "Pictogrammes", required: false, kind: "text" },
  { field: "voies_exposition", label: "Voies d'exposition", required: false, kind: "text" },
  { field: "mention_danger", label: "Mention de danger", required: false, kind: "text" },
  { field: "mesures_prevention", label: "Mesures de prévention", required: false, kind: "text" },
  { field: "niveau_risque", label: "Niveau de risque", required: false, kind: "text" },
  { field: "date_evaluation", label: "Date d'évaluation", required: false, kind: "date" },
  { field: "date_retrait", label: "Date de retrait", required: false, kind: "date", hint: "Vide = produit encore utilisé." },
];

const DEGRE_FIELDS: CanonicalField[] = [
  { field: "matricule", label: "Matricule", required: false, kind: "text" },
  { field: "nom", label: "Nom de famille", required: true, kind: "text" },
  { field: "prenom", label: "Prénom", required: true, kind: "text" },
  { field: "code_secteur", label: "Code secteur", required: true, kind: "text" },
  { field: "nom_produit", label: "Produit", required: true, kind: "text", hint: "Doit correspondre à une désignation de la liste des risques." },
  { field: "degre_exposition", label: "Degré d'exposition", required: true, kind: "text" },
];

/** Catalogue complet — pour l'endpoint de schéma consommé par le wizard. */
export function canonicalFieldCatalog(): Record<ListType, CanonicalField[]> {
  return {
    PERSONNEL: PERSONNEL_FIELDS,
    RISQUES_CHIMIQUES: RISQUES_FIELDS,
    DEGRE_EXPOSITION: DEGRE_FIELDS,
  };
}
