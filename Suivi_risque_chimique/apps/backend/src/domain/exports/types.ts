/**
 * Modèle de document d'export — NEUTRE vis-à-vis du format de sortie.
 *
 * Un même `ExportDocument` est rendu en PDF (pdfkit) ou en Excel (exceljs)
 * par les adaptateurs d'infrastructure. Le domaine décide du CONTENU et de la
 * STRUCTURE (titre, mentions légales, sections, lignes) ; l'infrastructure
 * décide de la mise en forme visuelle. Aucune dépendance à une lib de rendu
 * ici.
 */

export type ExportType =
  /** Les informations concernant UN salarié, pour lui (art. R. 4412-93-2). */
  | "individual"
  /** Liste anonymisée pour le CSE et les autres travailleurs (R. 4412-93-2). */
  | "cse_anonymized"
  /** Liste nominative complète pour le SPST / médecine (R. 4412-93-3). */
  | "spst_nominative";

/** Paire libellé/valeur (identité, références légales, périmètre). */
export interface KeyValue {
  label: string;
  value: string;
}

/** Tableau simple : colonnes + lignes de cellules déjà formatées en texte. */
export interface ExportTable {
  columns: string[];
  rows: string[][];
}

export interface ExportSection {
  heading?: string;
  /** Bloc d'identité / méta (rendu en liste de définitions). */
  fields?: KeyValue[];
  /** Données tabulaires. */
  table?: ExportTable;
  /** Remarques sous la section (ex. note de masquage k-anonymat). */
  notes?: string[];
}

export interface ExportDocument {
  type: ExportType;
  /** Titre principal du document. */
  title: string;
  /** Sous-titre (ex. nom de la personne, périmètre). */
  subtitle?: string;
  /** Méta d'en-tête : date de génération, références d'articles, périmètre. */
  meta: KeyValue[];
  sections: ExportSection[];
  /**
   * Avertissement de pied de page. Données de santé → on rappelle l'usage
   * restreint et la confidentialité sur CHAQUE document exporté.
   */
  disclaimer: string;
}
