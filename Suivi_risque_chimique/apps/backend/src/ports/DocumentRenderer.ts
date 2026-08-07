import type { ExportDocument } from "../domain/exports/types.js";

/** Format de fichier produit. */
export type ExportFormat = "pdf" | "xlsx";

/** Résultat d'un rendu : le binaire + de quoi servir le téléchargement. */
export interface RenderedDocument {
  buffer: Buffer;
  contentType: string;
  /** Nom de fichier proposé (sans données personnelles — cf. RGPD). */
  filename: string;
}

/**
 * Port `DocumentRenderer` — transforme un `ExportDocument` neutre en fichier.
 *
 * Une implémentation par format (PDF, Excel). Ajouter un format = écrire un
 * adaptateur, sans toucher au domaine ni aux cas d'usage.
 */
export interface DocumentRenderer {
  readonly format: ExportFormat;
  render(document: ExportDocument): Promise<RenderedDocument>;
}
