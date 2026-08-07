import { access } from "node:fs/promises";

import ExcelJS from "exceljs";

import type { SourceRow } from "../../../domain/mapping/types.js";
import type { DataSource, TableConfig } from "../../../ports/DataSource.js";
import { worksheetToRows } from "./worksheetToRows.js";

/**
 * Connecteur Excel — adaptateur du port `DataSource` pour les fichiers .xlsx.
 *
 * Conventions de lecture (en-têtes en ligne 1, cellules vides → null, numéro de
 * ligne source préservé, formules lues par leur résultat) : centralisées dans
 * worksheetToRows, partagées avec le connecteur CSV.
 */
export class ExcelDataSource implements DataSource {
  async test(): Promise<boolean> {
    return true; // la jointabilité réelle se vérifie par fichier dans fetchTable
  }

  async fetchTable(config: TableConfig): Promise<SourceRow[]> {
    await access(config.location); // erreur claire si le fichier n'existe pas

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(config.location);

    const worksheet =
      config.table !== undefined
        ? workbook.getWorksheet(config.table)
        : workbook.worksheets[0];
    if (!worksheet) {
      throw new Error(
        config.table !== undefined
          ? `Feuille « ${config.table} » introuvable dans ${config.location}.`
          : `Le fichier ${config.location} ne contient aucune feuille.`,
      );
    }

    return worksheetToRows(worksheet, config.location);
  }
}
