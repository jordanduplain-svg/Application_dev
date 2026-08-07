import ExcelJS from "exceljs";

import type { ExportDocument } from "../../domain/exports/types.js";
import type {
  DocumentRenderer,
  ExportFormat,
  RenderedDocument,
} from "../../ports/DocumentRenderer.js";
import { filenameFor } from "./filename.js";

/**
 * Rendu Excel des documents d'export (exceljs).
 *
 * Pensé pour l'EXPLOITATION (médecine du travail, archive HSE) : en-têtes
 * figés, colonnes ajustées, une ligne = une ligne de données filtrable.
 * Le bloc méta (références légales, date) est posé en haut, puis le tableau.
 */

const HEADER_FILL = "FF0F766E"; // teal-700 (ARGB)

export class XlsxRenderer implements DocumentRenderer {
  readonly format: ExportFormat = "xlsx";

  async render(document: ExportDocument): Promise<RenderedDocument> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Suivi du risque chimique";

    const sheet = workbook.addWorksheet("Export", {
      views: [{ state: "frozen", ySplit: 0 }], // figé ajusté après pose de l'en-tête
    });

    let cursor = 1;

    // --- Titre + sous-titre.
    sheet.getCell(`A${cursor}`).value = document.title;
    sheet.getCell(`A${cursor}`).font = { bold: true, size: 14 };
    cursor += 1;
    if (document.subtitle !== undefined) {
      sheet.getCell(`A${cursor}`).value = document.subtitle;
      sheet.getCell(`A${cursor}`).font = { color: { argb: "FF64748B" }, size: 11 };
      cursor += 1;
    }
    cursor += 1;

    // --- Méta (références légales).
    for (const m of document.meta) {
      sheet.getCell(`A${cursor}`).value = m.label;
      sheet.getCell(`A${cursor}`).font = { color: { argb: "FF64748B" } };
      sheet.getCell(`B${cursor}`).value = m.value;
      cursor += 1;
    }
    cursor += 1;

    // --- Sections.
    for (const section of document.sections) {
      if (section.heading !== undefined) {
        sheet.getCell(`A${cursor}`).value = section.heading;
        sheet.getCell(`A${cursor}`).font = { bold: true, size: 12 };
        cursor += 1;
      }

      if (section.fields !== undefined) {
        for (const f of section.fields) {
          sheet.getCell(`A${cursor}`).value = f.label;
          sheet.getCell(`A${cursor}`).font = { color: { argb: "FF64748B" } };
          sheet.getCell(`B${cursor}`).value = f.value;
          cursor += 1;
        }
        cursor += 1;
      }

      if (section.table !== undefined) {
        const headerRowNumber = cursor;
        const headerRow = sheet.getRow(cursor);
        headerRow.values = section.table.columns;
        headerRow.eachCell((cell) => {
          cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
          cell.alignment = { vertical: "middle", wrapText: true };
        });
        cursor += 1;

        for (const dataRow of section.table.rows) {
          sheet.getRow(cursor).values = dataRow;
          cursor += 1;
        }

        // Filtre auto + largeurs ajustées sur cette table.
        sheet.autoFilter = {
          from: { row: headerRowNumber, column: 1 },
          to: { row: headerRowNumber, column: section.table.columns.length },
        };
        this.fitColumns(sheet, section.table.columns, section.table.rows);
        // Fige sous l'en-tête du tableau pour le défilement.
        sheet.views = [{ state: "frozen", ySplit: headerRowNumber }];
        cursor += 1;
      }

      if (section.notes !== undefined) {
        for (const note of section.notes) {
          sheet.getCell(`A${cursor}`).value = note;
          sheet.getCell(`A${cursor}`).font = { italic: true, color: { argb: "FF64748B" } };
          cursor += 1;
        }
        cursor += 1;
      }
    }

    // --- Avertissement.
    sheet.getCell(`A${cursor}`).value = document.disclaimer;
    sheet.getCell(`A${cursor}`).font = { italic: true, size: 9, color: { argb: "FF64748B" } };

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      filename: filenameFor(document, "xlsx"),
    };
  }

  private fitColumns(sheet: ExcelJS.Worksheet, columns: string[], rows: string[][]): void {
    columns.forEach((col, i) => {
      let max = col.length;
      for (const row of rows) {
        const len = (row[i] ?? "").length;
        if (len > max) max = len;
      }
      // Bornes : lisible sans être démesuré.
      sheet.getColumn(i + 1).width = Math.min(Math.max(max + 2, 10), 45);
    });
  }
}
