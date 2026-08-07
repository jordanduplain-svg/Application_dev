import PDFDocument from "pdfkit";

import type { ExportDocument, ExportTable } from "../../domain/exports/types.js";
import type {
  DocumentRenderer,
  ExportFormat,
  RenderedDocument,
} from "../../ports/DocumentRenderer.js";
import { filenameFor } from "./filename.js";

/**
 * Rendu PDF des documents d'export (pdfkit).
 *
 * Orientation paysage A4 : les listes réglementaires sont larges (jusqu'à 15
 * colonnes pour le SPST). pdfkit n'a pas de composant tableau — on en dessine
 * un simple mais robuste (largeurs réparties, retour à la ligne par cellule,
 * saut de page automatique avec ré-affichage de l'en-tête).
 *
 * Couleurs sobres (gris/teal), cohérentes avec l'UI. Pas de fioritures : un
 * document officiel doit être lisible et imprimable.
 */

const MARGIN = 36;
const HEADER_FILL = "#0f766e"; // teal-700
const ROW_ALT = "#f8fafc"; // slate-50
const BORDER = "#e2e8f0"; // slate-200
const TEXT = "#0f172a"; // slate-900
const MUTED = "#64748b"; // slate-500

export class PdfRenderer implements DocumentRenderer {
  readonly format: ExportFormat = "pdf";

  async render(document: ExportDocument): Promise<RenderedDocument> {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: MARGIN });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => {
      doc.on("end", () => resolve(Buffer.concat(chunks)));
    });

    this.drawHeader(doc, document);
    for (const section of document.sections) {
      if (section.heading !== undefined) {
        this.ensureSpace(doc, 30);
        doc.moveDown(0.6);
        doc.fillColor(TEXT).fontSize(11).font("Helvetica-Bold").text(section.heading);
        doc.moveDown(0.2);
      }
      if (section.fields !== undefined) {
        this.drawFields(doc, section.fields);
      }
      if (section.table !== undefined) {
        this.drawTable(doc, section.table);
      }
      if (section.notes !== undefined && section.notes.length > 0) {
        doc.moveDown(0.4);
        const usable = doc.page.width - MARGIN * 2;
        for (const note of section.notes) {
          doc
            .fillColor(MUTED)
            .fontSize(8)
            .font("Helvetica-Oblique")
            .text(note, MARGIN, doc.y, { width: usable });
        }
      }
    }
    this.drawDisclaimer(doc, document.disclaimer);

    doc.end();
    const buffer = await done;
    return {
      buffer,
      contentType: "application/pdf",
      filename: filenameFor(document, "pdf"),
    };
  }

  private drawHeader(doc: PDFKit.PDFDocument, d: ExportDocument): void {
    doc.fillColor(TEXT).fontSize(16).font("Helvetica-Bold").text(d.title);
    if (d.subtitle !== undefined) {
      doc.fillColor(MUTED).fontSize(11).font("Helvetica").text(d.subtitle);
    }
    doc.moveDown(0.5);
    doc.fontSize(8.5).font("Helvetica");
    for (const m of d.meta) {
      doc
        .fillColor(MUTED)
        .text(`${m.label} : `, { continued: true })
        .fillColor(TEXT)
        .text(m.value);
    }
    doc.moveDown(0.3);
    const y = doc.y;
    doc
      .strokeColor(BORDER)
      .moveTo(MARGIN, y)
      .lineTo(doc.page.width - MARGIN, y)
      .stroke();
    doc.moveDown(0.4);
  }

  private drawFields(doc: PDFKit.PDFDocument, fields: { label: string; value: string }[]): void {
    doc.fontSize(9.5).font("Helvetica");
    for (const f of fields) {
      doc
        .fillColor(MUTED)
        .text(`${f.label} : `, { continued: true })
        .fillColor(TEXT)
        .text(f.value);
    }
    doc.moveDown(0.2);
  }

  private drawTable(doc: PDFKit.PDFDocument, table: ExportTable): void {
    const usable = doc.page.width - MARGIN * 2;
    const colWidth = usable / table.columns.length;
    const fontSize = table.columns.length > 9 ? 6.5 : 8;
    const padding = 3;

    const drawHeaderRow = (): void => {
      const top = doc.y;
      const height = this.rowHeight(doc, table.columns, colWidth, fontSize, padding);
      doc.rect(MARGIN, top, usable, height).fill(HEADER_FILL);
      doc.fillColor("#ffffff").fontSize(fontSize).font("Helvetica-Bold");
      table.columns.forEach((col, i) => {
        doc.text(col, MARGIN + i * colWidth + padding, top + padding, {
          width: colWidth - padding * 2,
        });
      });
      doc.y = top + height;
    };

    drawHeaderRow();

    table.rows.forEach((row, rowIndex) => {
      const height = this.rowHeight(doc, row, colWidth, fontSize, padding);
      // Saut de page : on garde l'en-tête de tableau sur la nouvelle page.
      if (doc.y + height > doc.page.height - MARGIN - 26) {
        doc.addPage();
        drawHeaderRow();
      }
      const top = doc.y;
      if (rowIndex % 2 === 1) {
        doc.rect(MARGIN, top, usable, height).fill(ROW_ALT);
      }
      doc.fillColor(TEXT).fontSize(fontSize).font("Helvetica");
      row.forEach((cell, i) => {
        doc.text(cell, MARGIN + i * colWidth + padding, top + padding, {
          width: colWidth - padding * 2,
        });
      });
      // Filets de séparation horizontaux.
      doc
        .strokeColor(BORDER)
        .moveTo(MARGIN, top + height)
        .lineTo(MARGIN + usable, top + height)
        .stroke();
      doc.y = top + height;
    });
    // Les cellules ont déplacé le curseur x sur la dernière colonne. On le
    // ramène à gauche pour que le texte suivant (notes, avertissement)
    // reprenne sur toute la largeur et non dans une colonne étroite.
    doc.x = MARGIN;
  }

  private rowHeight(
    doc: PDFKit.PDFDocument,
    cells: string[],
    colWidth: number,
    fontSize: number,
    padding: number,
  ): number {
    doc.fontSize(fontSize);
    let max = 0;
    for (const cell of cells) {
      const h = doc.heightOfString(cell, { width: colWidth - padding * 2 });
      if (h > max) max = h;
    }
    return max + padding * 2;
  }

  private drawDisclaimer(doc: PDFKit.PDFDocument, disclaimer: string): void {
    this.ensureSpace(doc, 40);
    doc.moveDown(0.8);
    const y = doc.y;
    doc
      .strokeColor(BORDER)
      .moveTo(MARGIN, y)
      .lineTo(doc.page.width - MARGIN, y)
      .stroke();
    doc.moveDown(0.4);
    doc
      .fillColor(MUTED)
      .fontSize(7.5)
      .font("Helvetica-Oblique")
      .text(disclaimer, MARGIN, doc.y, { width: doc.page.width - MARGIN * 2 });
  }

  private ensureSpace(doc: PDFKit.PDFDocument, needed: number): void {
    if (doc.y + needed > doc.page.height - MARGIN) doc.addPage();
  }
}
