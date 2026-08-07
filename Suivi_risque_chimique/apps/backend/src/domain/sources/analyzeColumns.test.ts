import { describe, expect, it } from "vitest";

import { analyzeColumns } from "./analyzeColumns.js";
import type { SourceRow } from "../mapping/types.js";

const rows = (...data: Record<string, unknown>[]): SourceRow[] =>
  data.map((d, i) => ({ rowNumber: i + 2, data: d }));

describe("analyzeColumns", () => {
  it("compte le remplissage et les valeurs distinctes par colonne", () => {
    const analysis = analyzeColumns(
      rows(
        { Nom: "Martin", Secteur: "ATELIER-A" },
        { Nom: "Durand", Secteur: "ATELIER-A" },
        { Nom: "Petit", Secteur: "" },
      ),
    );
    expect(analysis.rowCount).toBe(3);
    const secteur = analysis.columns.find((c) => c.name === "Secteur")!;
    expect(secteur.filledCount).toBe(2);
    expect(secteur.distinctCount).toBe(1);
    const nom = analysis.columns.find((c) => c.name === "Nom")!;
    expect(nom.distinctCount).toBe(3);
  });

  it("infère le type date pour une colonne de dates (formats mêlés)", () => {
    const analysis = analyzeColumns(
      rows(
        { Entree: "15/01/2024" },
        { Entree: "2023-06-30" },
        { Entree: 45123 }, // série Excel
      ),
    );
    expect(analysis.columns[0]!.inferredType).toBe("date");
  });

  it("infère le type number pour une colonne numérique", () => {
    const analysis = analyzeColumns(rows({ Effectif: 12 }, { Effectif: "8" }));
    expect(analysis.columns[0]!.inferredType).toBe("number");
  });

  it("retombe sur text dès qu'une cellule casse l'homogénéité", () => {
    const analysis = analyzeColumns(
      rows({ Champ: "15/01/2024" }, { Champ: "à compléter" }),
    );
    expect(analysis.columns[0]!.inferredType).toBe("text");
  });

  it("marque empty une colonne entièrement vide", () => {
    const analysis = analyzeColumns(rows({ Vide: "" }, { Vide: null }));
    expect(analysis.columns[0]!.inferredType).toBe("empty");
    expect(analysis.columns[0]!.filledCount).toBe(0);
  });

  it("limite l'échantillon à sampleSize valeurs distinctes", () => {
    const analysis = analyzeColumns(
      rows(...Array.from({ length: 20 }, (_, i) => ({ Code: `C${i}` }))),
      3,
    );
    expect(analysis.columns[0]!.sampleValues).toHaveLength(3);
    expect(analysis.columns[0]!.distinctCount).toBe(20);
  });

  it("prend l'union des colonnes même si certaines lignes en omettent", () => {
    const analysis = analyzeColumns(rows({ A: "x" }, { B: "y" }));
    expect(analysis.columns.map((c) => c.name).sort()).toEqual(["A", "B"]);
  });
});
