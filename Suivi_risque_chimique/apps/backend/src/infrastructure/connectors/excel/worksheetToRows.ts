import type ExcelJS from "exceljs";

import type { RawRow, SourceRow } from "../../../domain/mapping/types.js";

/**
 * Convertit une feuille exceljs (issue d'un .xlsx OU d'un .csv parsé) en lignes
 * brutes canoniques. Partagé par les connecteurs Excel et CSV : la convention
 * de lecture (en-têtes en ligne 1, cellules vides → null, numéro de ligne
 * source préservé) doit être IDENTIQUE quel que soit le format de fichier.
 */
export function worksheetToRows(worksheet: ExcelJS.Worksheet, location: string): SourceRow[] {
  // --- Ligne 1 : les en-têtes.
  const headers: (string | null)[] = [];
  worksheet.getRow(1).eachCell({ includeEmpty: true }, (cell, colNumber) => {
    const value = cellToRaw(cell.value);
    headers[colNumber] = value === null ? null : String(value).trim();
  });

  const namedColumns = headers
    .map((h, idx) => ({ header: h, idx }))
    .filter((c): c is { header: string; idx: number } => c.header !== null && c.header !== "");

  if (namedColumns.length === 0) {
    throw new Error(`La première ligne de ${location} ne contient aucun en-tête de colonne.`);
  }

  const rows: SourceRow[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const record: RawRow = {};
    let hasValue = false;
    for (const { header, idx } of namedColumns) {
      const value = cellToRaw(row.getCell(idx).value);
      record[header] = value;
      if (value !== null) hasValue = true;
    }
    if (hasValue) rows.push({ rowNumber, data: record });
  });

  return rows;
}

/**
 * Réduit la valeur de cellule exceljs à un type brut exploitable.
 * exceljs renvoie des unions complexes (richText, formules, hyperliens…) —
 * on aplatit tout vers string | number | boolean | Date | null.
 */
export function cellToRaw(value: ExcelJS.CellValue): string | number | boolean | Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    // Une cellule qui ne contient que des blancs EST vide pour l'utilisateur.
    return value.trim() === "" ? null : value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "object") {
    // Formule : on prend le résultat calculé.
    if ("formula" in value || "sharedFormula" in value) {
      const result = (value as ExcelJS.CellFormulaValue).result;
      if (result === undefined || result === null) return null;
      if (result instanceof Date) return result;
      if (typeof result === "object" && "error" in result) return null;
      return result;
    }
    if ("richText" in value) {
      return (value as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join("");
    }
    if ("text" in value) return (value as ExcelJS.CellHyperlinkValue).text;
    if ("error" in value) return null;
  }
  return String(value);
}
