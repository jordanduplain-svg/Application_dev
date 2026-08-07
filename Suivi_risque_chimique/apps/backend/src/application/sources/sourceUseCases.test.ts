import { describe, expect, it } from "vitest";

import type { MappingConfig, SourceRow } from "../../domain/mapping/types.js";
import type { ConnectorFactory } from "../../ports/ConnectorFactory.js";
import type { DataSource } from "../../ports/DataSource.js";
import { DryRunMappingUseCase } from "./DryRunMappingUseCase.js";
import { PreviewSourceUseCase } from "./PreviewSourceUseCase.js";

/** Connecteur en mémoire : rend des lignes fixes quel que soit le type. */
function connectorOf(rows: SourceRow[]): ConnectorFactory {
  const source: DataSource = {
    test: () => Promise.resolve(true),
    fetchTable: () => Promise.resolve(rows),
  };
  return { create: () => source };
}

const personnelRows: SourceRow[] = [
  { rowNumber: 2, data: { Mat: "EMP-1", Nom: "Martin", Prenom: "Marie", Sec: "ATELIER-A", Entree: "2020-01-15" } },
  { rowNumber: 3, data: { Mat: "EMP-2", Nom: "Durand", Prenom: "Jean", Sec: "ATELIER-A", Entree: "" } },
  // Même secteur que les autres, mais saisi en minuscules : sans normalisation
  // c'est une valeur distincte ; la règle uppercase doit les fusionner.
  { rowNumber: 4, data: { Mat: "", Nom: "Petit", Prenom: "Luc", Sec: "atelier-a", Entree: "2019-03-01" } },
];

const personnelMapping: MappingConfig = {
  listType: "PERSONNEL",
  columns: {
    matricule: "Mat",
    nom: "Nom",
    prenom: "Prenom",
    code_secteur: "Sec",
    date_debut_secteur: "Entree",
  },
};

describe("PreviewSourceUseCase", () => {
  it("profile les colonnes et renvoie un échantillon", async () => {
    const useCase = new PreviewSourceUseCase(connectorOf(personnelRows));
    const result = await useCase.execute({ connectorType: "excel", table: { location: "x" } });

    expect(result.rowCount).toBe(3);
    expect(result.sampleRows).toHaveLength(3);
    const sec = result.columns.find((c) => c.name === "Sec")!;
    expect(sec.distinctCount).toBe(2); // "ATELIER-A" (×2) et "atelier-a" : 2 textes distincts
    const entree = result.columns.find((c) => c.name === "Entree")!;
    expect(entree.filledCount).toBe(2); // une cellule vide
  });

  it("applique les règles avant de profiler (uppercase unifie le secteur)", async () => {
    const useCase = new PreviewSourceUseCase(connectorOf(personnelRows));
    const result = await useCase.execute({
      connectorType: "excel",
      table: { location: "x" },
      rules: [{ kind: "uppercase", column: "Sec" }],
    });
    const sec = result.columns.find((c) => c.name === "Sec")!;
    expect(sec.distinctCount).toBe(1); // tout devient "ATELIER-A" après normalisation
  });
});

describe("DryRunMappingUseCase", () => {
  it("compte les lignes importables et rejetées sans rien écrire", async () => {
    const useCase = new DryRunMappingUseCase(connectorOf(personnelRows));
    const result = await useCase.execute({
      connectorType: "excel",
      table: { location: "x" },
      mapping: personnelMapping,
    });

    expect(result.rowsRead).toBe(3);
    expect(result.wouldImport).toBe(2); // la ligne sans date d'entrée est rejetée
    expect(result.wouldReject).toBe(1);
    expect(result.configError).toBe(false);
    expect(result.anomalies.some((a) => a.code === "missing_required_field")).toBe(true);
  });

  it("signale une erreur de config (colonne mappée absente) → 0 importée", async () => {
    const useCase = new DryRunMappingUseCase(connectorOf(personnelRows));
    const result = await useCase.execute({
      connectorType: "excel",
      table: { location: "x" },
      mapping: {
        ...personnelMapping,
        columns: { ...personnelMapping.columns, nom: "ColonneInexistante" },
      },
    });

    expect(result.configError).toBe(true);
    expect(result.wouldImport).toBe(0);
    expect(result.wouldReject).toBe(3);
  });

  it("un filtre de règle retire des lignes avant le mapping", async () => {
    const useCase = new DryRunMappingUseCase(connectorOf(personnelRows));
    const result = await useCase.execute({
      connectorType: "excel",
      table: { location: "x" },
      mapping: {
        ...personnelMapping,
        // On écarte la ligne « Durand » (celle sans date d'entrée).
        rules: [{ kind: "filterRowWhen", column: "Nom", equals: "Durand" }],
      },
    });
    // Reste 2 lignes, toutes deux avec une date → toutes importables.
    expect(result.rowsRead).toBe(2);
    expect(result.wouldImport).toBe(2);
  });
});
