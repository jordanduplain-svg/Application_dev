import type { ExportDocument } from "../../domain/exports/types.js";
import type { ExportFormat } from "../../ports/DocumentRenderer.js";

/**
 * Nom de fichier d'export — SANS donnée personnelle (RGPD : pas de PII dans
 * les noms de fichiers, qui finissent dans les téléchargements, les logs, les
 * pièces jointes d'email). On nomme par TYPE de document et date, jamais par
 * nom de salarié.
 */
const BASENAME: Record<ExportDocument["type"], string> = {
  individual: "attestation-exposition-cmr",
  cse_anonymized: "liste-anonymisee-cmr",
  spst_nominative: "liste-nominative-spst-cmr",
};

export function filenameFor(document: ExportDocument, format: ExportFormat): string {
  // La date d'édition figure déjà en méta ; on la reprend si présente, sinon
  // un suffixe neutre. On n'introduit pas d'horloge ici (pureté du nommage).
  const dateMeta = document.meta.find((m) => m.label === "Date d'édition")?.value;
  const datePart = dateMeta !== undefined ? `-${dateMeta.split("/").reverse().join("-")}` : "";
  return `${BASENAME[document.type]}${datePart}.${format}`;
}
