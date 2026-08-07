import { access } from "node:fs/promises";

import ExcelJS from "exceljs";

import type { SourceRow } from "../../../domain/mapping/types.js";
import type { DataSource, TableConfig } from "../../../ports/DataSource.js";
import { worksheetToRows } from "../excel/worksheetToRows.js";

/**
 * Connecteur CSV — adaptateur du port `DataSource` pour les fichiers .csv.
 *
 * Les exports RH/HSE sont souvent fournis en CSV (séparateur point-virgule en
 * France, encodage hétérogène). exceljs sait parser un CSV en une feuille ;
 * on réutilise alors EXACTEMENT la même extraction que pour Excel
 * (worksheetToRows) pour garantir un comportement identique entre formats.
 *
 * Séparateur : on tente d'abord le point-virgule (convention FR — Excel France
 * exporte en `;`), puis la virgule en repli. La détection est faite sur la
 * ligne d'en-tête, là où la structure est la plus fiable.
 */
export class CsvDataSource implements DataSource {
  async test(): Promise<boolean> {
    return true;
  }

  async fetchTable(config: TableConfig): Promise<SourceRow[]> {
    await access(config.location);

    const delimiter = await detectDelimiter(config.location);
    const workbook = new ExcelJS.Workbook();
    const worksheet = await workbook.csv.readFile(config.location, {
      parserOptions: { delimiter },
      // On DÉSACTIVE l'auto-parsing de dates d'exceljs (dateFormats: []) : il
      // convertit « 2020-03-01 » en Date locale, ce qui, réexposé en UTC,
      // décale d'un jour selon le fuseau. On garde les cellules en TEXTE BRUT
      // tel que dans le fichier ; le parsing métier des dates est fait par le
      // domaine (parseFlexibleDate), de façon déterministe et en UTC.
      dateFormats: [],
    });
    if (!worksheet) {
      throw new Error(`Le fichier CSV ${config.location} est vide ou illisible.`);
    }

    return worksheetToRows(worksheet, config.location);
  }
}

/**
 * Devine le séparateur à partir de la première ligne : on compte `;` et `,`
 * et on retient le plus fréquent (point-virgule en cas d'égalité, convention
 * française). Une heuristique simple suffit ; un séparateur explicitement
 * configuré pourra être ajouté à TableConfig si un cas réel l'exige.
 */
async function detectDelimiter(location: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  const head = (await readFile(location, "utf8")).split(/\r?\n/, 1)[0] ?? "";
  const semicolons = (head.match(/;/g) ?? []).length;
  const commas = (head.match(/,/g) ?? []).length;
  return commas > semicolons ? "," : ";";
}
